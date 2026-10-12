import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ACTIVE_STATUSES,
  applyOverride,
  can,
  quote,
  todayIn,
  type Booking,
  type CreateBookingInput,
  type IsoDate,
  type PriceResult,
  type QuoteRequest,
  type QuoteResponse,
  type UnitFee,
} from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { MemberNames } from '../../common/db/member-names';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, forbidden, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { BlocksService } from '../inventory/blocks.service';
import { kobo } from '../inventory/mappers';
import { BOOKING_INCLUDE, toBooking, toSummary, type BookingRow } from './booking.mapper';
import { BookingHooks } from './booking-hooks';

const day = (s: IsoDate) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface BookingListParams {
  from?: IsoDate;
  to?: IsoDate;
  status?: string;
  unitId?: string;
  source?: string;
  q?: string;
  balanceDue?: string;
  cursor?: string;
  limit: number;
  guestId?: string;
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly audit: AuditService,
    private readonly blocks: BlocksService,
    private readonly names: MemberNames,
    readonly hooks: BookingHooks,
  ) {}

  async loadPricingInputs(tx: OrgTx, unitId: string) {
    const unit = await tx.unit.findFirst({ where: { id: unitId, active: true } });
    if (!unit) throw new AppError('VALIDATION_FAILED', 400, 'Unit not found or archived');
    const fees = await tx.unitFee.findMany({
      where: { unitId, active: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      unit,
      fees: fees.map((f) => ({
        kind: f.kind as UnitFee['kind'],
        label: f.label,
        amountKobo: kobo(f.amountKobo),
        basis: f.basis as UnitFee['basis'],
        includedGuests: f.includedGuests,
        active: f.active,
      })),
    };
  }

  /** iCal blocks are warnings, not refusals: the other channel may already be out of date (BKG-03). */
  async icalWarnings(tx: OrgTx, unitId: string, checkIn: IsoDate, checkOut: IsoDate) {
    const rows = await tx.block.findMany({
      where: { unitId, source: 'ical', start: { lt: day(checkOut) }, end: { gt: day(checkIn) } },
    });
    return rows.map((b) => ({
      kind: 'ical_overlap' as const,
      blockId: b.id,
      summary: b.externalSummary ?? 'External booking',
    }));
  }

  async conflictFor(
    tx: OrgTx,
    unitId: string,
    checkIn: IsoDate,
    checkOut: IsoDate,
    ignoreBookingId?: string,
  ) {
    const b = await tx.booking.findFirst({
      where: {
        unitId,
        status: { in: [...ACTIVE_STATUSES] },
        checkIn: { lt: day(checkOut) },
        checkOut: { gt: day(checkIn) },
        ...(ignoreBookingId && { id: { not: ignoreBookingId } }),
      },
    });
    if (b) return { kind: 'booking' as const, id: b.id };
    return this.blocks.conflicts(tx, unitId, checkIn, checkOut);
  }

  quote(ctx: OrgCtx, q: QuoteRequest): Promise<QuoteResponse> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const { unit, fees } = await this.loadPricingInputs(tx, q.unitId);
      const r = quote({
        nightlyRateKobo: kobo(unit.nightlyRateKobo),
        fees,
        checkIn: q.checkIn,
        checkOut: q.checkOut,
        guestCount: q.guestCount,
      });
      const conflict = await this.conflictFor(tx, q.unitId, q.checkIn, q.checkOut);
      return {
        ...r,
        available: !conflict,
        conflict,
        warnings: await this.icalWarnings(tx, q.unitId, q.checkIn, q.checkOut),
        maxGuests: unit.maxGuests,
      };
    });
  }

  async writeLines(tx: OrgTx, bookingId: string, r: PriceResult) {
    await tx.bookingLine.deleteMany({ where: { bookingId } });
    await tx.bookingLine.createMany({
      data: r.lines.map((l, i) => ({
        id: newId(),
        bookingId,
        position: i,
        kind: l.kind,
        feeKind: l.feeKind,
        label: l.label,
        quantity: new Prisma.Decimal(l.quantity),
        unitAmountKobo: BigInt(l.unitAmountKobo),
        amountKobo: BigInt(l.amountKobo),
        refundable: l.refundable,
        recognition: l.recognition,
      })) as never,
    });
  }

  /** `<prefix>-<YYMM>-<seq>` with YYMM in the operator's timezone (BKG-13). */
  async nextRef(tx: OrgTx, ctx: OrgCtx): Promise<string> {
    const s = await tx.orgSettings.findFirstOrThrow();
    const n = await this.orgDb.nextNumber(tx, 'booking');
    const yymm = todayIn(ctx.timezone).slice(2, 7).replace('-', '');
    return `${s.bookingPrefix}-${yymm}-${String(n).padStart(4, '0')}`;
  }

  checkCapacity(ctx: OrgCtx, guestCount: number, maxGuests: number, reason?: string) {
    if (guestCount <= maxGuests) return;
    if (ctx.role === 'admin' && reason) return;
    throw new AppError(
      'CAPACITY_EXCEEDED',
      422,
      `This unit sleeps ${maxGuests}. An admin can allow more with a reason.`,
    );
  }

  create(ctx: OrgCtx, input: CreateBookingInput): Promise<Booking> {
    if (input.finalTotalKobo !== undefined && !can(ctx.role, 'bookings.override'))
      throw forbidden('You cannot change prices');
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const { unit, fees } = await this.loadPricingInputs(tx, input.unitId);
      if (!(await tx.guest.findFirst({ where: { id: input.guestId, anonymisedAt: null } }))) {
        throw new AppError('VALIDATION_FAILED', 400, 'Guest not found');
      }
      this.checkCapacity(ctx, input.guestCount, unit.maxGuests, input.capacityOverrideReason);
      // Locks the unit row and asks every calendar source (blocks + bookings); the exclusion constraint is the backstop.
      await this.blocks.assertUnitFree(tx, input.unitId, input.checkIn, input.checkOut);
      const warnings = await this.icalWarnings(tx, input.unitId, input.checkIn, input.checkOut);
      if (warnings.length && !input.acknowledgeIcalOverlap) {
        throw new AppError('ICAL_OVERLAP', 409, 'These dates overlap a booking on another channel', {
          warnings,
        });
      }

      let price = quote({
        nightlyRateKobo: kobo(unit.nightlyRateKobo),
        fees,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        guestCount: input.guestCount,
      });
      if (input.finalTotalKobo !== undefined) price = applyOverride(price, input.finalTotalKobo);

      const s = await tx.orgSettings.findFirstOrThrow();
      const id = newId();
      const ref = await this.nextRef(tx, ctx);
      await tx.booking.create({
        data: {
          id,
          ref,
          unitId: input.unitId,
          guestId: input.guestId,
          checkIn: day(input.checkIn),
          checkOut: day(input.checkOut),
          guestCount: input.guestCount,
          source: input.source,
          status: input.status,
          holdUntil: input.status === 'tentative' ? new Date(Date.now() + s.holdHours * 3_600_000) : null,
          computedTotalKobo: BigInt(price.computedTotalKobo),
          finalTotalKobo: BigInt(price.finalTotalKobo),
          depositKobo: BigInt(price.depositKobo),
          overrideReason: input.finalTotalKobo !== undefined ? input.overrideReason : null,
          capacityOverrideReason: input.guestCount > unit.maxGuests ? input.capacityOverrideReason : null,
          icalWarningAck: warnings.length > 0,
          notes: input.notes ?? null,
          createdByMemberId: ctx.memberId,
        } as never,
      });
      await this.writeLines(tx, id, price);
      await tx.bookingStatusEvent.create({
        data: {
          id: newId(),
          bookingId: id,
          fromStatus: null,
          toStatus: input.status,
          actorMemberId: ctx.memberId,
        } as never,
      });
      const booking = await this.getIn(tx, ctx.orgId, id);
      await this.audit.record(tx, {
        actor: ctx,
        action: 'booking.create',
        entity: 'booking',
        entityId: id,
        after: {
          ref,
          unitId: input.unitId,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          finalTotalKobo: price.finalTotalKobo,
          overrideReason: input.overrideReason,
        },
      });
      await this.hooks.run('afterCreate', tx, ctx, booking);
      return booking;
    });
  }

  async hydrate(tx: OrgTx, orgId: string, rows: BookingRow[]): Promise<Booking[]> {
    const names = await this.names.forMembers(
      orgId,
      rows.flatMap((r) => r.events.map((e) => e.actorMemberId).filter((x): x is string => !!x)),
      tx,
    );
    const out = rows.map((r) => toBooking(r, names));
    await this.hooks.run('decorate', tx, out);
    return out;
  }

  async getIn(tx: OrgTx, orgId: string, id: string): Promise<Booking> {
    const r = await tx.booking.findFirst({ where: { id }, include: BOOKING_INCLUDE });
    if (!r) throw notFound('Booking');
    return (await this.hydrate(tx, orgId, [r]))[0]!;
  }

  get(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, (tx) => this.getIn(tx, ctx.orgId, id));
  }

  list(ctx: OrgCtx, q: BookingListParams) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const digits = q.q?.replace(/\D/g, '').replace(/^0/, '');
      const where: Prisma.BookingWhereInput = {
        ...(q.status && { status: q.status }),
        ...(q.unitId && { unitId: q.unitId }),
        ...(q.source && { source: q.source }),
        ...(q.guestId && { guestId: q.guestId }),
        ...(q.from && { checkOut: { gt: day(q.from) } }),
        ...(q.to && { checkIn: { lt: day(q.to) } }),
        ...(q.q && {
          OR: [
            { ref: { contains: q.q, mode: 'insensitive' } },
            { guest: { fullName: { contains: q.q, mode: 'insensitive' } } },
            ...(digits ? [{ guest: { phoneE164: { contains: digits } } }] : []),
          ],
        }),
      };
      const cursor = q.cursor
        ? (JSON.parse(Buffer.from(q.cursor, 'base64url').toString()) as { c: string; id: string })
        : null;
      const rows = await tx.booking.findMany({
        where: cursor
          ? {
              AND: [
                where,
                {
                  OR: [{ checkIn: { lt: day(cursor.c) } }, { checkIn: day(cursor.c), id: { lt: cursor.id } }],
                },
              ],
            }
          : where,
        include: BOOKING_INCLUDE,
        orderBy: [{ checkIn: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
      });
      const page = rows.slice(0, q.limit);
      let items = (await this.hydrate(tx, ctx.orgId, page)).map(toSummary);
      // Filtered after pagination for v1 page sizes; M3 moves this into SQL on the ledger.
      if (q.balanceDue === 'true') items = items.filter((b) => (b.balanceKobo ?? 0) > 0);
      const last = page.at(-1);
      return {
        items,
        nextCursor:
          rows.length > q.limit && last
            ? Buffer.from(JSON.stringify({ c: iso(last.checkIn), id: last.id })).toString('base64url')
            : null,
      };
    });
  }
}
