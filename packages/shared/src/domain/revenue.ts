import type { BookingStatus } from '../contracts/calendar';
import { eachNight, type IsoDate } from './dates';
import { assertKobo } from './money';
import type { LineKind, Recognition } from './pricing';

export interface RevenueLine { kind: LineKind; amountKobo: number; recognition: Recognition }
export interface RevenueBooking { id: string; ref: string; unitId: string; status: BookingStatus; checkIn: IsoDate; checkOut: IsoDate; lines: RevenueLine[]; cancelledOn: IsoDate | null; retainedKobo: number }
export interface WithheldDeposit { bookingId: string; ref: string; unitId: string; date: IsoDate; amountKobo: number }
export interface RevenueEntry { unitId: string; date: IsoDate; amountKobo: number; bookingId: string; ref: string; source: 'stay' | 'cancellation' | 'damage' }

const EARNING: BookingStatus[] = ['confirmed', 'checked_in', 'checked_out', 'no_show'];
export const inMonth = (date: IsoDate, period: IsoDate) => date.slice(0, 7) === period.slice(0, 7);

/** Accrual per night (D-017). Each line's remainder kobo — positive or negative — goes to the first night so the stay sums exactly. */
export function recognise(bookings: RevenueBooking[], withheld: WithheldDeposit[]): RevenueEntry[] {
  const out: RevenueEntry[] = [];
  for (const b of bookings) {
    if (b.status === 'cancelled') {
      assertKobo(b.retainedKobo);
      if (b.retainedKobo !== 0 && !b.cancelledOn) throw new Error(`Booking ${b.ref} is cancelled without a cancellation date`);
      if (b.cancelledOn && b.retainedKobo !== 0) out.push({ unitId: b.unitId, date: b.cancelledOn, amountKobo: b.retainedKobo, bookingId: b.id, ref: b.ref, source: 'cancellation' });
      continue;
    }
    if (!EARNING.includes(b.status)) continue;
    const nights = eachNight(b.checkIn, b.checkOut);
    if (!nights.length) throw new Error(`Booking ${b.ref} has no nights`);
    const perNight = new Array<number>(nights.length).fill(0);
    for (const l of b.lines) {
      if (l.kind === 'deposit') continue;
      assertKobo(l.amountKobo);
      if (l.recognition === 'on_check_in') { perNight[0]! += l.amountKobo; continue; }
      const each = Math.trunc(l.amountKobo / nights.length);
      perNight[0]! += l.amountKobo - each * nights.length;
      for (let i = 0; i < nights.length; i++) perNight[i]! += each;
    }
    nights.forEach((d, i) => { if (perNight[i] !== 0) out.push({ unitId: b.unitId, date: d, amountKobo: perNight[i]!, bookingId: b.id, ref: b.ref, source: 'stay' }); });
  }
  for (const w of withheld) assertKobo(w.amountKobo);
  for (const w of withheld) out.push({ unitId: w.unitId, date: w.date, amountKobo: w.amountKobo, bookingId: w.bookingId, ref: w.ref, source: 'damage' });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.bookingId.localeCompare(b.bookingId));
}
