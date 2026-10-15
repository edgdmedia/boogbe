import { Injectable } from '@nestjs/common';
import { eachNight, quote, todayIn, type IsoDate, type PublicQuoteResponse } from '@boogbe/shared';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { AppError } from '../../common/http/app-error';
import { BookingsService } from '../bookings/bookings.service';
import { CalendarSources } from '../calendar/calendar-sources';
import { kobo } from '../inventory/mappers';
import { PublicOrgService, type PublicOrg } from './public-org.service';

export const invalidDates = (m: string) => new AppError('INVALID_DATES', 422, m);

/**
 * The calendar sources take a member context for the back office's redaction rules; none reads it today, and the
 * public read keeps only `start`/`end`/`status` of what they return, so labels, names or refs never leave this
 * service. A source that starts using `ctx` must handle its absence here.
 */
const NO_MEMBER = null as unknown as OrgCtx;

@Injectable()
export class PublicReadService {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly orgs: PublicOrgService,
    private readonly bookings: BookingsService,
    private readonly sources: CalendarSources,
  ) {}

  units(org: PublicOrg) {
    return this.orgDb.run(org.orgId, async (tx) => {
      const rows = await tx.unit.findMany({
        where: { active: true, publicListed: true, property: { active: true } },
        include: { property: true },
        orderBy: [{ property: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
      });
      return {
        units: rows.map((u) => ({
          id: u.id,
          propertyId: u.propertyId,
          propertyName: u.property.name,
          name: u.name,
          bedrooms: u.bedrooms,
          maxGuests: u.maxGuests,
          nightlyRateKobo: kobo(u.nightlyRateKobo),
        })),
      };
    });
  }

  /**
   * Every night in [from, to) that any calendar source occupies: active bookings (tentative included), manual
   * blocks and iCal blocks. iCal blocks are hard unavailability here, unlike the back office (plan deviation 4).
   */
  async blockedNights(tx: OrgTx, unitId: string, from: IsoDate, to: IsoDate): Promise<IsoDate[]> {
    const nights = new Set<IsoDate>();
    for (const s of this.sources.all()) {
      for (const it of await s.items(tx, [unitId], from, to, NO_MEMBER)) {
        if (it.kind === 'booking' && (it.status === 'cancelled' || it.status === 'checked_out' || it.status === 'no_show')) continue;
        for (const n of eachNight(it.start, it.end)) if (n >= from && n < to) nights.add(n);
      }
    }
    return [...nights].sort();
  }

  availability(org: PublicOrg, unitId: string, from: IsoDate, to: IsoDate) {
    if (from < todayIn(org.timezone)) throw invalidDates('Dates must be today or later');
    return this.orgDb.run(org.orgId, async (tx) => {
      await this.orgs.listedUnit(tx, unitId);
      const s = await tx.orgSettings.findFirstOrThrow();
      return {
        unitId,
        from,
        to,
        blockedNights: await this.blockedNights(tx, unitId, from, to),
        checkInTime: s.checkInTime,
        checkOutTime: s.checkOutTime,
      };
    });
  }

  /** Same pricing function and fee rows the back office quotes with (BookingsService.loadPricingInputs + quote). */
  quote(org: PublicOrg, unitId: string, checkIn: IsoDate, checkOut: IsoDate, guests: number): Promise<PublicQuoteResponse> {
    if (checkIn < todayIn(org.timezone)) throw invalidDates('Dates must be today or later');
    return this.orgDb.run(org.orgId, async (tx) => {
      await this.orgs.listedUnit(tx, unitId);
      const { unit, fees } = await this.bookings.loadPricingInputs(tx, unitId);
      if (guests > unit.maxGuests) throw new AppError('TOO_MANY_GUESTS', 422, `This apartment sleeps ${unit.maxGuests}`);
      if ((await this.blockedNights(tx, unitId, checkIn, checkOut)).length)
        throw new AppError('DATES_UNAVAILABLE', 409, 'Those dates are not available');
      const r = quote({ nightlyRateKobo: kobo(unit.nightlyRateKobo), fees, checkIn, checkOut, guestCount: guests });
      return {
        nights: r.nights,
        lines: r.lines.map((l) => ({ kind: l.kind, label: l.label, amountKobo: l.amountKobo })),
        totalKobo: r.finalTotalKobo,
        depositKobo: r.depositKobo,
      };
    });
  }
}
