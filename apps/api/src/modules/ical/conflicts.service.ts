import { Injectable, OnModuleInit } from '@nestjs/common';
import { ACTIVE_STATUSES, CHANNEL_LABELS, type Channel, type ResolveConflictInput, type SyncConflict } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingHooks } from '../bookings/booking-hooks';
import { PaymentsService } from '../payments/payments.service';
import { IcalSyncService } from './sync.service';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const pairKey = (bookingId: string, blockId: string | null) => `${bookingId}|${blockId}`;
const channelLabel = (c: string | null) => (c ? CHANNEL_LABELS[c as Channel] : 'another channel');
const RESOLUTION = { external: 'external', cancel_booking: 'cancelled_booking', moved_booking: 'moved_booking' } as const;

/** Bookings that overlap a block imported from a channel: detection, auto-clear, resolution (ICS-05, CAL-04). */
@Injectable()
export class ConflictsService implements OnModuleInit {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly sync: IcalSyncService,
    private readonly bookingHooks: BookingHooks,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit() {
    this.sync.afterSync = (tx, orgId, unitId) => this.recompute(tx, orgId, unitId);
    this.bookingHooks.register({
      afterCreate: (tx, ctx, b) => this.recompute(tx, ctx.orgId, b.unit.id),
      afterUpdate: async (tx, ctx, before, after) => {
        // Sorted, so two moves in opposite directions lock the units in the same order.
        for (const unitId of [...new Set([before.unit.id, after.unit.id])].sort()) await this.recompute(tx, ctx.orgId, unitId);
      },
      // The holds job transitions without a member context; the org is still set on the transaction.
      afterTransition: async (tx, ctx, b) => {
        const orgId = ctx?.orgId ?? (await tx.$queryRaw<{ o: string }[]>`SELECT app_current_org() AS o`)[0]!.o;
        await this.recompute(tx, orgId, b.unit.id);
      },
    });
  }

  /**
   * Opens a conflict for each active booking × channel block overlap on the unit, and clears open ones whose pair no
   * longer overlaps (block gone, booking moved, shortened or no longer active). A pair the operator resolved as
   * "handled on the channel" stays resolved, or every sync would raise it again.
   */
  async recompute(tx: OrgTx, orgId: string, unitId: string): Promise<void> {
    // One recompute per unit at a time, so two syncs/edits can't both open the same conflict. An advisory lock, not
    // `unit … FOR UPDATE`: booking edits already lock units and bookings in their own order, and a second row lock
    // here deadlocked two bookings swapping units. While held, this only touches sync_conflict and notification rows.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sync_conflict:${unitId}`}, 0))`;
    const pairs = await tx.$queryRaw<
      { booking_id: string; ref: string; block_id: string; start: Date; end: Date; summary: string | null; channel: string | null }[]
    >`
      SELECT b.id AS booking_id, b.ref, k.id AS block_id, k.start, k."end", k.external_summary AS summary, f.channel
      FROM booking b
      JOIN block k ON k.unit_id = b.unit_id AND k.source = 'ical'
      LEFT JOIN ical_feed f ON f.id = k.feed_id
      WHERE b.unit_id = ${unitId} AND b.status = ANY(${[...ACTIVE_STATUSES]}) AND k.start < b.check_out AND k."end" > b.check_in`;
    const live = new Set(pairs.map((p) => pairKey(p.booking_id, p.block_id)));
    const known = await tx.syncConflict.findMany({
      where: { unitId, OR: [{ status: 'open' }, { resolution: 'external' }] },
      select: { id: true, bookingId: true, blockId: true, status: true },
    });
    for (const c of known) {
      if (c.status === 'open' && !live.has(pairKey(c.bookingId, c.blockId))) {
        await tx.syncConflict.updateMany({
          where: { id: c.id, status: 'open' },
          data: { status: 'resolved', resolution: 'cleared', resolvedAt: new Date() },
        });
      }
    }
    const handled = new Set(known.filter((c) => c.blockId).map((c) => pairKey(c.bookingId, c.blockId)));
    for (const p of pairs) {
      if (handled.has(pairKey(p.booking_id, p.block_id))) continue;
      const conflictId = newId();
      await tx.syncConflict.create({
        data: {
          id: conflictId,
          unitId,
          bookingId: p.booking_id,
          blockId: p.block_id,
          blockStart: p.start,
          blockEnd: p.end,
          blockSummary: p.summary ?? 'External booking',
          channel: p.channel,
        } as never,
      });
      await this.notifications.notifyRoles(
        tx,
        orgId,
        ['admin', 'frontdesk'],
        {
          kind: 'ical_conflict',
          title: `Possible double booking: ${p.ref}`,
          body: `${channelLabel(p.channel)} shows ${iso(p.start)} – ${iso(p.end)} as taken, which overlaps ${p.ref}. Check both and resolve it.`,
          link: '/conflicts',
          // One alert per episode: a pair that clears and later overlaps again is a new conflict row, so it alerts again.
          dedupeKey: `conflict-${conflictId}`,
        },
        { email: true },
      );
    }
  }

  list(ctx: OrgCtx, status: 'open' | 'resolved'): Promise<{ items: SyncConflict[] }> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const rows = await tx.syncConflict.findMany({ where: { status }, orderBy: { createdAt: 'desc' }, take: 100 });
      const bookings = await tx.booking.findMany({
        where: { id: { in: rows.map((r) => r.bookingId) } },
        include: { guest: true, unit: true },
      });
      const bm = new Map(bookings.map((b) => [b.id, b]));
      return {
        items: rows.flatMap((r) => {
          const b = bm.get(r.bookingId);
          if (!b) return []; // bookings are never hard-deleted (FK NO ACTION); skip rather than crash if one is
          return {
            id: r.id,
            status: r.status as SyncConflict['status'],
            resolution: r.resolution as SyncConflict['resolution'],
            unit: { id: b.unit.id, name: b.unit.name },
            booking: { id: b.id, ref: b.ref, guestName: b.guest.fullName, checkIn: iso(b.checkIn), checkOut: iso(b.checkOut), status: b.status },
            block: {
              id: r.blockId ?? '',
              start: iso(r.blockStart),
              end: iso(r.blockEnd),
              summary: r.blockSummary,
              channel: r.channel as SyncConflict['block']['channel'],
            },
            createdAt: r.createdAt.toISOString(),
            resolvedAt: r.resolvedAt?.toISOString() ?? null,
          };
        }),
      };
    });
  }

  /** One transaction: a cancel whose refund is refused leaves both the booking and the conflict untouched. */
  resolve(ctx: OrgCtx, id: string, input: ResolveConflictInput) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const c = await tx.syncConflict.findFirst({ where: { id, status: 'open' } });
      if (!c) throw notFound('Conflict');
      if (input.action === 'cancel_booking') {
        // Cancelling clears the conflict through the transition hook; the resolution below then records why.
        await this.payments.cancelWithRefundIn(tx, ctx, c.bookingId, {
          reason: `Double-booked with ${channelLabel(c.channel)}`,
          refundKobo: input.refundKobo,
          refundMethod: input.refundMethod,
        });
      }
      if (input.action === 'moved_booking') {
        const b = await tx.booking.findFirst({ where: { id: c.bookingId } });
        const stillOverlaps =
          b &&
          b.unitId === c.unitId &&
          (ACTIVE_STATUSES as readonly string[]).includes(b.status) &&
          b.checkIn < c.blockEnd &&
          b.checkOut > c.blockStart;
        if (stillOverlaps) throw new AppError('CONFLICT', 409, 'Move or shorten the booking first, then mark it resolved');
      }
      const resolution = RESOLUTION[input.action];
      await tx.syncConflict.updateMany({
        where: { id },
        data: { status: 'resolved', resolution, resolvedAt: new Date(), resolvedByMemberId: ctx.memberId },
      });
      await this.audit.record(tx, {
        actor: ctx,
        action: `conflict.${resolution}`,
        entity: 'sync_conflict',
        entityId: id,
        after: input,
      });
      return { ok: true };
    });
  }
}
