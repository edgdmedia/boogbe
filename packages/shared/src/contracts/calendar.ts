import { z } from 'zod';
import { IsoDateSchema } from './common';
import { addDays } from '../domain/dates';

export const CalendarQuery = z
  .object({ from: IsoDateSchema, to: IsoDateSchema })
  .refine((q) => q.to > q.from, { path: ['to'], message: 'to must be after from' })
  .refine((q) => q.to <= addDays(q.from, 62), { path: ['to'], message: 'At most 62 days' });
export type CalendarQuery = z.infer<typeof CalendarQuery>;

export const CalendarUnit = z.object({
  id: z.string(),
  name: z.string(),
  bedrooms: z.number().int(),
  maxGuests: z.number().int(),
  nightlyRateKobo: z.number().int(),
});
export const CalendarProperty = z.object({ id: z.string(), name: z.string(), units: z.array(CalendarUnit) });
export const BookingStatus = z.enum(['tentative', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show']);
export type BookingStatus = z.infer<typeof BookingStatus>;
export const CalendarItem = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('booking'),
    id: z.string(),
    unitId: z.string(),
    start: z.string(),
    end: z.string(),
    status: BookingStatus,
    ref: z.string(),
    guestName: z.string().nullable(),
    balanceKobo: z.number().int().nullable(),
    hasConflict: z.boolean(),
  }),
  z.object({
    kind: z.literal('block'),
    id: z.string(),
    unitId: z.string(),
    start: z.string(),
    end: z.string(),
    source: z.enum(['manual', 'ical']),
    reason: z.string(),
    label: z.string(),
  }),
]);
export type CalendarItem = z.infer<typeof CalendarItem>;
export const CalendarResponse = z.object({
  from: z.string(),
  to: z.string(),
  today: z.string(),
  properties: z.array(CalendarProperty),
  items: z.array(CalendarItem),
});
export type CalendarResponse = z.infer<typeof CalendarResponse>;
