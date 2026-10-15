import { z } from 'zod';
import { isIsoDate, nightsBetween } from '../domain/dates';
import { normalizePhone } from '../domain/phone';
import { PriceLineSchema } from './bookings';

// Unauthenticated routes under /v1/public/:slug (WB). Responses never carry guest names, other refs, sources or block reasons.
export const MAX_WINDOW_DAYS = 90;
export const MAX_NIGHTS = 30;
const Day = z.string().refine(isIsoDate, 'Use YYYY-MM-DD');
// zod still runs object refinements after a field refinement fails, so these must not assume valid dates (nightsBetween throws).
const span = (from: string, to: string, max: number) => isIsoDate(from) && isIsoDate(to) && to > from && nightsBetween(from, to) <= max;

export const PublicUnit = z.object({
  id: z.string(),
  propertyId: z.string(),
  propertyName: z.string(),
  name: z.string(),
  bedrooms: z.number().int(),
  maxGuests: z.number().int(),
  nightlyRateKobo: z.number().int(),
});
export type PublicUnit = z.infer<typeof PublicUnit>;
export const PublicUnitsResponse = z.object({ units: z.array(PublicUnit) });
export type PublicUnitsResponse = z.infer<typeof PublicUnitsResponse>;

export const AvailabilityQuery = z
  .object({ from: Day, to: Day })
  .refine((q) => span(q.from, q.to, MAX_WINDOW_DAYS), {
    message: `Window must be 1–${MAX_WINDOW_DAYS} days`,
    path: ['to'],
  });
export type AvailabilityQuery = z.infer<typeof AvailabilityQuery>;
export const AvailabilityResponse = z.object({
  unitId: z.string(),
  from: Day,
  to: Day,
  blockedNights: z.array(Day),
  checkInTime: z.string(),
  checkOutTime: z.string(),
});
export type AvailabilityResponse = z.infer<typeof AvailabilityResponse>;

const stay = <T extends { checkIn: string; checkOut: string }>(s: T) => span(s.checkIn, s.checkOut, MAX_NIGHTS);
export const PublicQuoteQuery = z
  .object({ checkIn: Day, checkOut: Day, guests: z.coerce.number().int().min(1).max(20) })
  .refine(stay, { message: `Stays are 1–${MAX_NIGHTS} nights`, path: ['checkOut'] });
export type PublicQuoteQuery = z.infer<typeof PublicQuoteQuery>;
export const PublicQuoteResponse = z.object({
  nights: z.number().int(),
  lines: z.array(PriceLineSchema.pick({ label: true, amountKobo: true, kind: true })),
  totalKobo: z.number().int(),
  depositKobo: z.number().int(),
});
export type PublicQuoteResponse = z.infer<typeof PublicQuoteResponse>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));
export const BookingRequestInput = z
  .object({
    unitId: z.string().min(1),
    checkIn: Day,
    checkOut: Day,
    guests: z.number().int().min(1).max(20),
    fullName: z.string().trim().min(2).max(100),
    phone: z
      .string()
      .transform((v, c) => normalizePhone(v) ?? (c.addIssue({ code: 'custom', message: 'Enter a valid phone number' }), z.NEVER)),
    email: z
      .union([z.literal(''), z.string().trim().email().max(150)])
      .optional()
      .transform((v) => (v ? v : undefined)),
    note: optionalText(1000),
    turnstileToken: z.string().min(1).max(2048),
  })
  .refine(stay, { message: `Stays are 1–${MAX_NIGHTS} nights`, path: ['checkOut'] });
export type BookingRequestInput = z.infer<typeof BookingRequestInput>;
export const BookingRequestResponse = z.object({ ref: z.string(), holdUntil: z.string(), totalKobo: z.number().int() });
export type BookingRequestResponse = z.infer<typeof BookingRequestResponse>;
