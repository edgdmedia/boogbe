import { describe, expect, it } from 'vitest';
import { AvailabilityQuery, BookingRequestInput, PublicQuoteQuery } from './public';
import { BookingSourceEnum, BookingSummary, SOURCE_LABELS } from './bookings';
import { NotificationKind } from './notifications';
import { ERROR_CODES } from '../errors';

describe('public contracts', () => {
  it('availability window ≤ 90 days and ordered', () => {
    expect(AvailabilityQuery.safeParse({ from: '2026-11-01', to: '2027-01-30' }).success).toBe(true);
    expect(AvailabilityQuery.safeParse({ from: '2026-11-01', to: '2027-02-01' }).success).toBe(false);
    expect(AvailabilityQuery.safeParse({ from: '2026-11-02', to: '2026-11-01' }).success).toBe(false);
    expect(AvailabilityQuery.safeParse({ from: '2026-11-01', to: 'soon' }).success).toBe(false);
  });

  it('quote coerces guests and caps nights', () => {
    expect(PublicQuoteQuery.parse({ checkIn: '2026-11-01', checkOut: '2026-11-03', guests: '2' }).guests).toBe(2);
    expect(PublicQuoteQuery.safeParse({ checkIn: '2026-11-01', checkOut: '2026-12-05', guests: '2' }).success).toBe(false);
    expect(PublicQuoteQuery.safeParse({ checkIn: '2026-11-03', checkOut: '2026-11-03', guests: '2' }).success).toBe(false);
    expect(PublicQuoteQuery.safeParse({ checkIn: '2026-11-01', checkOut: '2026-11-03', guests: '0' }).success).toBe(false);
  });

  it('malformed dates are a validation failure, never a thrown error (public input → 400, not 500)', () => {
    expect(PublicQuoteQuery.safeParse({ checkIn: '2026-02-30', checkOut: '2026-03-02', guests: '2' }).success).toBe(false);
    expect(PublicQuoteQuery.safeParse({ checkIn: '2026-11-01', checkOut: 'x', guests: '2' }).success).toBe(false);
    expect(AvailabilityQuery.safeParse({ from: 'nope', to: '2026-11-03' }).success).toBe(false);
  });

  it('request normalises phone and trims text', () => {
    const r = BookingRequestInput.parse({
      unitId: 'u1', checkIn: '2026-11-01', checkOut: '2026-11-03', guests: 2,
      fullName: '  Ada  Obi ', phone: '0803 000 0000', email: '', note: ' hi ', turnstileToken: 't',
    });
    expect(r).toMatchObject({ fullName: 'Ada  Obi', phone: '+2348030000000', email: undefined, note: 'hi' });
    expect(BookingRequestInput.safeParse({ ...r, phone: '12' }).success).toBe(false);
    expect(BookingRequestInput.safeParse({ ...r, email: 'not-an-email' }).success).toBe(false);
    expect(BookingRequestInput.safeParse({ ...r, note: 'x'.repeat(1001) }).success).toBe(false);
    expect(BookingRequestInput.safeParse({ ...r, fullName: 'A' }).success).toBe(false);
  });

  it('treats a blank or null email as no email; caps ids and phone length (public input)', () => {
    const base = { unitId: 'u1', checkIn: '2026-11-01', checkOut: '2026-11-03', guests: 2, fullName: 'Ada Obi', phone: '08030000000', turnstileToken: 't' };
    expect(BookingRequestInput.parse({ ...base, email: '   ' }).email).toBeUndefined();
    expect(BookingRequestInput.parse({ ...base, email: null }).email).toBeUndefined();
    expect(BookingRequestInput.parse({ ...base, email: ' ada@example.ng ' }).email).toBe('ada@example.ng');
    expect(BookingRequestInput.safeParse({ ...base, unitId: 'x'.repeat(65) }).success).toBe(false);
    expect(BookingRequestInput.safeParse({ ...base, phone: '0'.repeat(33) }).success).toBe(false);
  });
});

describe('website source and related codes', () => {
  it('website is a booking source labelled "Website"', () => {
    expect(BookingSourceEnum.options).toContain('website');
    expect(SOURCE_LABELS.website).toBe('Website');
  });
  it('summaries carry the hold expiry for list countdowns', () => {
    expect(BookingSummary.shape.holdUntil.safeParse(null).success).toBe(true);
    expect(BookingSummary.shape.holdUntil.safeParse('2026-11-01T12:00:00.000Z').success).toBe(true);
  });
  it('appends error codes and the notification kind', () => {
    for (const c of ['UNAVAILABLE', 'VERIFICATION_FAILED', 'TOO_MANY_GUESTS', 'INVALID_DATES']) expect(ERROR_CODES).toContain(c);
    expect(NotificationKind.options).toContain('website_request');
  });
});
