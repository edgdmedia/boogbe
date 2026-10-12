import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ACTIVE_STATUSES,
  applyOverride,
  can,
  canTransition,
  quote,
  STATUS_LABELS,
  todayIn,
  type Booking,
  type BookingStatus,
  type CancelBookingInput,
  type CreateBookingInput,
  type TransitionInput,
  type UpdateBookingInput,
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

  /** Shared by the API, the holds job (ctx null) and M3 auto-confirm. Conditional on the current status, so racing writers get 409. */
  async transitionIn(
    tx: OrgTx,
    ctx: OrgCtx | null,
    orgId: string,
    id: string,
    to: BookingStatus,
    reason?: string,
  ): Promise<Booking> {
    const b = await tx.booking.findFirst({ where: { id } });
    if (!b) throw notFound('Booking');
    const from = b.status as BookingStatus;
    if (!canTransition(from, to)) {
      throw new AppError(
        'INVALID_TRANSITION',
        422,
        `A ${STATUS_LABELS[from].toLowerCase()} booking cannot become ${STATUS_LABELS[to].toLowerCase()}`,
      );
    }
    const now = new Date();
    const r = await tx.booking.updateMany({
      where: { id, status: from },
      data: {
        status: to,
        holdUntil: null,
        ...(to === 'checked_in' && { checkedInAt: now }),
        ...(to === 'checked_out' && { checkedOutAt: now }),
        ...(to === 'cancelled' && { cancelledAt: now, cancelReason: reason ?? null }),
      },
    });
    if (!r.count) throw new AppError('CONFLICT', 409, 'The booking changed — refresh and try again');
    await tx.bookingStatusEvent.create({
      data: {
        id: newId(),
        bookingId: id,
        fromStatus: from,
        toStatus: to,
        actorMemberId: ctx?.memberId ?? null,
        reason: reason ?? null,
      } as never,
    });
    if (ctx) {
      await this.audit.record(tx, {
        actor: ctx,
        action: `booking.${to}`,
        entity: 'booking',
        entityId: id,
        before: { status: from },
        after: { status: to, reason },
      });
    }
    const booking = await this.getIn(tx, orgId, id);
    await this.hooks.run('afterTransition', tx, ctx, booking, from);
    return booking;
  }

  transition(ctx: OrgCtx, id: string, input: TransitionInput) {
    return this.orgDb.run(ctx.orgId, (tx) =>
      this.transitionIn(tx, ctx, ctx.orgId, id, input.to, input.reason),
    );
  }

  /** Cancelling frees the dates at once: the exclusion constraint only covers active statuses (BKG-11). */
  cancel(ctx: OrgCtx, id: string, input: CancelBookingInput) {
    return this.orgDb.run(ctx.orgId, (tx) =>
      this.transitionIn(tx, ctx, ctx.orgId, id, 'cancelled', input.reason),
    );
  }

  update(ctx: OrgCtx, id: string, input: UpdateBookingInput): Promise<Booking> {
    if (input.finalTotalKobo !== undefined && !can(ctx.role, 'bookings.override'))
      throw forbidden('You cannot change prices');
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const before = await this.getIn(tx, ctx.orgId, id);
      const editable = before.status === 'tentative' || before.status === 'confirmed';
      const datesChanging =
        input.unitId !== undefined || input.checkIn !== undefined || input.checkOut !== undefined;
      if (!editable && before.status !== 'checked_in') {
        throw new AppError('INVALID_TRANSITION', 422, 'This booking can no longer be changed');
      }
      if (before.status === 'checked_in' && (input.unitId !== undefined || input.checkIn !== undefined)) {
        throw new AppError('INVALID_TRANSITION', 422, 'Only the check-out date can change after check-in');
      }

      const next = {
        unitId: input.unitId ?? before.unit.id,
        checkIn: input.checkIn ?? before.checkIn,
        checkOut: input.checkOut ?? before.checkOut,
        guestCount: input.guestCount ?? before.guestCount,
      };
      if (next.checkOut <= next.checkIn)
        throw new AppError('VALIDATION_FAILED', 400, 'Check-out must be after check-in');
      const { unit, fees } = await this.loadPricingInputs(tx, next.unitId);
      if (input.guestCount !== undefined || input.unitId !== undefined) {
        this.checkCapacity(ctx, next.guestCount, unit.maxGuests, input.capacityOverrideReason);
      }
      let icalAck = before.icalWarningAck;
      if (datesChanging) {
        // Ignoring itself lets a stay be extended or moved onto dates it already holds.
        await this.blocks.assertUnitFree(tx, next.unitId, next.checkIn, next.checkOut, { bookingId: id });
        const warnings = await this.icalWarnings(tx, next.unitId, next.checkIn, next.checkOut);
        if (warnings.length && !input.acknowledgeIcalOverlap) {
          throw new AppError('ICAL_OVERLAP', 409, 'These dates overlap a booking on another channel', {
            warnings,
          });
        }
        icalAck = warnings.length > 0;
      }
      if (
        input.guestId &&
        !(await tx.guest.findFirst({ where: { id: input.guestId, anonymisedAt: null } }))
      ) {
        throw new AppError('VALIDATION_FAILED', 400, 'Guest not found');
      }

      const pricingChanged = datesChanging || input.guestCount !== undefined;
      const data: Record<string, unknown> = {
        unitId: next.unitId,
        checkIn: day(next.checkIn),
        checkOut: day(next.checkOut),
        guestCount: next.guestCount,
        icalWarningAck: icalAck,
        ...(input.guestId && { guestId: input.guestId }),
        ...(input.source && { source: input.source }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.capacityOverrideReason && { capacityOverrideReason: input.capacityOverrideReason }),
      };
      if (input.reprice || input.finalTotalKobo !== undefined) {
        // Without reprice the stored lines are kept; applyOverride only reads lines and computedTotalKobo.
        let price: PriceResult = input.reprice
          ? quote({
              nightlyRateKobo: kobo(unit.nightlyRateKobo),
              fees,
              checkIn: next.checkIn,
              checkOut: next.checkOut,
              guestCount: next.guestCount,
            })
          : {
              nights: 0,
              lines: before.lines,
              computedTotalKobo: before.computedTotalKobo,
              finalTotalKobo: before.finalTotalKobo,
              depositKobo: before.depositKobo,
            };
        if (input.finalTotalKobo !== undefined) price = applyOverride(price, input.finalTotalKobo);
        await this.writeLines(tx, id, price);
        Object.assign(data, {
          computedTotalKobo: BigInt(price.computedTotalKobo),
          finalTotalKobo: BigInt(price.finalTotalKobo),
          depositKobo: BigInt(price.depositKobo),
          overrideReason:
            input.finalTotalKobo !== undefined
              ? input.overrideReason
              : input.reprice
                ? null
                : before.overrideReason,
          priceStale: input.reprice ? false : before.priceStale || pricingChanged,
        });
      } else if (pricingChanged) {
        data.priceStale = true;
      }
      await tx.booking.updateMany({ where: { id }, data });
      const after = await this.getIn(tx, ctx.orgId, id);
      await this.audit.record(tx, {
        actor: ctx,
        action: 'booking.update',
        entity: 'booking',
        entityId: id,
        before: {
          unitId: before.unit.id,
          checkIn: before.checkIn,
          checkOut: before.checkOut,
          finalTotalKobo: before.finalTotalKobo,
        },
        after: input,
      });
      await this.hooks.run('afterUpdate', tx, ctx, before, after);
      return after;
    });
  }
}
