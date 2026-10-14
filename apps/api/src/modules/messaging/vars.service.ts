import { Injectable } from '@nestjs/common';
import { formatNaira, nightsBetween, type TemplateVars } from '@boogbe/shared';
import type { OrgTx } from '../../common/db/org-db.service';
import { OrgInfo } from '../../common/db/org-info';
import { BookingsService } from '../bookings/bookings.service';

/** `9 Oct 2026` — stay dates are calendar dates, so format them in UTC (no timezone shift). */
const date = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** `14:00` → `2:00 pm`, `12:00` → `12:00 pm`, `00:30` → `12:30 am`. */
const time = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h! < 12 ? 'am' : 'pm'}`;
};

/** The values a template's placeholders are filled with for one booking (MSG-02). */
@Injectable()
export class VarsService {
  constructor(
    private readonly bookings: BookingsService,
    private readonly orgInfo: OrgInfo,
  ) {}

  async forBooking(tx: OrgTx, orgId: string, bookingId: string, opts: { lastPaymentKobo?: number } = {}): Promise<TemplateVars> {
    const b = await this.bookings.getIn(tx, orgId, bookingId);
    const unit = await tx.unit.findFirstOrThrow({ where: { id: b.unit.id }, include: { property: true } });
    const s = await tx.orgSettings.findFirstOrThrow();
    const org = await this.orgInfo.get(orgId, tx); // same transaction: no second pooled connection
    const fullName = b.guest.fullName.trim();
    return {
      'guest.firstName': fullName.split(/\s+/)[0] || fullName,
      'guest.fullName': b.guest.fullName,
      'booking.ref': b.ref,
      'booking.checkIn': date(b.checkIn),
      'booking.checkOut': date(b.checkOut),
      'booking.nights': String(nightsBetween(b.checkIn, b.checkOut)),
      'booking.guests': String(b.guestCount),
      'unit.name': unit.name,
      'property.name': unit.property.name,
      'property.address': unit.property.address,
      'money.total': formatNaira(b.finalTotalKobo),
      'money.paid': formatNaira(b.paidKobo ?? 0),
      // An overpaid booking reads "₦0" to the guest, never a negative balance.
      'money.balance': formatNaira(Math.max(0, b.balanceKobo ?? b.finalTotalKobo)),
      'money.deposit': formatNaira(b.depositKobo),
      'money.lastPayment': formatNaira(opts.lastPaymentKobo ?? 0),
      'operator.name': org.name,
      'operator.phone': org.phone ?? '',
      'operator.email': org.email ?? '',
      'checkIn.time': time(s.checkInTime),
      'checkOut.time': time(s.checkOutTime),
      'unit.checkInInstructions': unit.checkInInstructions ?? '',
    };
  }
}
