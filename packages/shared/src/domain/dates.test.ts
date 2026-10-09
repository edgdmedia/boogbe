import { describe, expect, it } from 'vitest';
import { addDays, eachNight, isIsoDate, monthOf, nightsBetween, rangesOverlap, todayIn, zonedTimeToUtc } from './dates';

describe('dates', () => {
  it('validates ISO dates strictly', () => {
    expect(isIsoDate('2026-10-09')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-1-09')).toBe(false);
  });
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('counts nights for half-open stays', () => {
    expect(nightsBetween('2026-10-09', '2026-10-12')).toBe(3);
    expect(() => nightsBetween('2026-10-09', '2026-10-09')).toThrow('check-out must be after check-in');
  });
  it('detects overlap with half-open semantics (same-day turnover allowed)', () => {
    expect(rangesOverlap('2026-10-01', '2026-10-05', '2026-10-05', '2026-10-07')).toBe(false);
    expect(rangesOverlap('2026-10-01', '2026-10-05', '2026-10-04', '2026-10-07')).toBe(true);
    expect(rangesOverlap('2026-10-01', '2026-10-10', '2026-10-03', '2026-10-04')).toBe(true);
  });
  it('lists each night of a stay', () => {
    expect(eachNight('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });
  it('computes today in the operator timezone', () => {
    // 23:30 UTC on 9 Oct is 00:30 on 10 Oct in Lagos (UTC+1)
    expect(todayIn('Africa/Lagos', new Date('2026-10-09T23:30:00Z'))).toBe('2026-10-10');
  });
  it('gets first of month', () => {
    expect(monthOf('2026-10-31')).toBe('2026-10-01');
  });
  it('converts a local Lagos time to UTC', () => {
    expect(zonedTimeToUtc('2026-10-09', '14:00', 'Africa/Lagos').toISOString()).toBe('2026-10-09T13:00:00.000Z');
  });
});
