import { Injectable, OnModuleInit } from '@nestjs/common';
import { ACTIVE_STATUSES, type CalendarItem, type IsoDate } from '@boogbe/shared';
import type { OrgTx } from '../../common/db/org-db.service';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { CalendarSources, type CalendarSource, type Ignore } from '../calendar/calendar-sources';

const day = (s: IsoDate) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Bookings on the calendar, and as hard conflicts for blocks and other bookings. */
@Injectable()
export class BookingSourceImpl implements CalendarSource, OnModuleInit {
  constructor(private readonly sources: CalendarSources) {}
  onModuleInit() {
    this.sources.register(this);
  }

  async items(
    tx: OrgTx,
    unitIds: string[],
    from: IsoDate,
    to: IsoDate,
    _ctx: OrgCtx,
  ): Promise<CalendarItem[]> {
    const rows = await tx.booking.findMany({
      where: {
        unitId: { in: unitIds },
        status: { in: [...ACTIVE_STATUSES, 'checked_out'] },
        checkIn: { lt: day(to) },
        checkOut: { gt: day(from) },
      },
      include: { guest: { select: { fullName: true } } },
    });
    const money = rows.length
      ? await tx.$queryRaw<{ booking_id: string; balance_kobo: bigint }[]>`
          SELECT booking_id, balance_kobo FROM booking_money WHERE booking_id = ANY(${rows.map((r) => r.id)})`
      : [];
    const bal = new Map(money.map((m) => [m.booking_id, Number(m.balance_kobo)]));
    const conflicts = rows.length
      ? await tx.syncConflict.findMany({
          where: { bookingId: { in: rows.map((r) => r.id) }, status: 'open' },
          select: { bookingId: true },
        })
      : [];
    const flagged = new Set(conflicts.map((c) => c.bookingId));
    return rows.map((b) => ({
      kind: 'booking',
      id: b.id,
      unitId: b.unitId,
      start: iso(b.checkIn),
      end: iso(b.checkOut),
      status: b.status as never,
      ref: b.ref,
      guestName: b.guest.fullName,
      balanceKobo: bal.get(b.id) ?? null,
      hasConflict: flagged.has(b.id), // an open channel conflict (T-M4-05)
    }));
  }

  async conflicts(tx: OrgTx, unitId: string, start: IsoDate, end: IsoDate, ignore?: Ignore) {
    const b = await tx.booking.findFirst({
      where: {
        unitId,
        status: { in: [...ACTIVE_STATUSES] },
        checkIn: { lt: day(end) },
        checkOut: { gt: day(start) },
        ...(ignore?.bookingId && { id: { not: ignore.bookingId } }),
      },
    });
    return b ? { kind: 'booking' as const, id: b.id } : null;
  }
}
