import { addDays, zonedTimeToUtc, type IsoDate } from './dates';

/** HSK-02: due before the next arrival if it is within a day of check-out, otherwise by 18:00 local the next day. */
export function turnoverDue(p: { checkOut: IsoDate; nextCheckIn: IsoDate | null; checkInTime: string; timeZone: string }): { dueAt: Date; priority: 'normal' | 'high' } {
  if (p.nextCheckIn && p.nextCheckIn < p.checkOut) throw new Error('Next arrival is before check-out');
  const nextDay = addDays(p.checkOut, 1);
  if (p.nextCheckIn && p.nextCheckIn <= nextDay) {
    return { dueAt: zonedTimeToUtc(p.nextCheckIn, p.checkInTime, p.timeZone), priority: p.nextCheckIn === p.checkOut ? 'high' : 'normal' };
  }
  return { dueAt: zonedTimeToUtc(nextDay, '18:00', p.timeZone), priority: 'normal' };
}
