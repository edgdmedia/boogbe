import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MoneySummary, PaymentMethod } from '@boogbe/shared';
import { OrgDb } from '../../common/db/org-db.service';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { BookingsService } from '../bookings/bookings.service';
import { BOOKING_INCLUDE, toSummary } from '../bookings/booking.mapper';

@Injectable()
export class MoneyService {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly bookings: BookingsService,
  ) {}

  /** Money dashboard (PAY-07): receipts in `[from, to)` by method, plus outstanding balances and deposits held now. */
  summary(ctx: OrgCtx, q: { from: string; to: string; propertyId?: string }): Promise<MoneySummary> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const prop = q.propertyId ? Prisma.sql`AND u.property_id = ${q.propertyId}` : Prisma.empty;
      const byMethod = await tx.$queryRaw<{ method: PaymentMethod; kobo: bigint }[]>`
        SELECT e.method, sum(e.amount_kobo)::bigint AS kobo
        FROM payment_effective e JOIN booking b ON b.id = e.booking_id JOIN unit u ON u.id = b.unit_id
        WHERE e.kind = 'payment' AND e.received_on >= ${q.from}::date AND e.received_on < ${q.to}::date ${prop}
        GROUP BY e.method ORDER BY 2 DESC`;
      const [ref] = await tx.$queryRaw<{ kobo: bigint | null }[]>`
        SELECT sum(e.amount_kobo)::bigint AS kobo
        FROM payment_effective e JOIN booking b ON b.id = e.booking_id JOIN unit u ON u.id = b.unit_id
        WHERE e.kind = 'refund' AND e.received_on >= ${q.from}::date AND e.received_on < ${q.to}::date ${prop}`;
      // The OR is parenthesised so the property filter applies to both branches.
      const money = await tx.$queryRaw<{ booking_id: string; deposit_held_kobo: bigint }[]>`
        SELECT m.booking_id, m.deposit_held_kobo
        FROM booking_money m JOIN booking b ON b.id = m.booking_id JOIN unit u ON u.id = b.unit_id
        WHERE ((m.balance_kobo > 0 AND m.status IN ('tentative','confirmed','checked_in','checked_out')) OR m.deposit_held_kobo > 0) ${prop}`;
      const ids = money.map((m) => m.booking_id);
      const rows = ids.length
        ? await tx.booking.findMany({
            where: { id: { in: ids } },
            include: BOOKING_INCLUDE,
            orderBy: { checkIn: 'asc' },
          })
        : [];
      const full = await this.bookings.hydrate(tx, ctx.orgId, rows);
      return {
        receivedByMethod: byMethod.map((r) => ({ method: r.method, kobo: Number(r.kobo) })),
        totalReceivedKobo: byMethod.reduce((s, r) => s + Number(r.kobo), 0),
        refundsKobo: Number(ref?.kobo ?? 0n),
        depositsHeldKobo: money.reduce((s, m) => s + Math.max(0, Number(m.deposit_held_kobo)), 0),
        outstanding: full
          .filter((b) => (b.balanceKobo ?? 0) > 0 && b.status !== 'cancelled')
          .slice(0, 100)
          .map(toSummary),
        depositsToReturn: full
          .filter((b) => b.status === 'checked_out' && (b.depositHeldKobo ?? 0) > 0)
          .sort((a, b) => a.checkOut.localeCompare(b.checkOut))
          .map((b) => ({
            bookingId: b.id,
            ref: b.ref,
            guestName: b.guest.fullName,
            unitName: b.unit.name,
            checkOut: b.checkOut,
            heldKobo: b.depositHeldKobo!,
          })),
      };
    });
  }
}
