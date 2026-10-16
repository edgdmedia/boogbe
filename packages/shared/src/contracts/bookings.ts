import { z } from 'zod';
import { BookingSourceEnum } from './booking-source';
import { BookingStatus } from './calendar';
import { IsoDateSchema, Kobo } from './common';
import { UnitFeeKind } from './inventory';

// Lives in its own module so calendar.ts can use it without an import cycle.
export { BookingSourceEnum, SOURCE_LABELS, type BookingSourceValue } from './booking-source';

export const PriceLineSchema = z.object({
  kind: z.enum(['accommodation', 'fee', 'deposit', 'adjustment']),
  feeKind: UnitFeeKind.nullable(),
  label: z.string(),
  quantity: z.number(),
  unitAmountKobo: z.number().int(),
  amountKobo: z.number().int(),
  refundable: z.boolean(),
  recognition: z.enum(['per_night', 'on_check_in']),
});

const Stay = z
  .object({ unitId: z.string(), checkIn: IsoDateSchema, checkOut: IsoDateSchema, guestCount: z.number().int().min(1).max(50) })
  .refine((s) => s.checkOut > s.checkIn, { path: ['checkOut'], message: 'Check-out must be after check-in' });

export const QuoteRequest = Stay;
export type QuoteRequest = z.infer<typeof QuoteRequest>;
export const Warning = z.object({ kind: z.literal('ical_overlap'), blockId: z.string(), summary: z.string() });
export const QuoteResponse = z.object({
  nights: z.number().int(),
  lines: z.array(PriceLineSchema),
  computedTotalKobo: z.number().int(),
  finalTotalKobo: z.number().int(),
  depositKobo: z.number().int(),
  available: z.boolean(),
  conflict: z.object({ kind: z.enum(['booking', 'block']), id: z.string() }).nullable(),
  warnings: z.array(Warning),
  maxGuests: z.number().int(),
});
export type QuoteResponse = z.infer<typeof QuoteResponse>;

export const CreateBookingInput = Stay.and(
  z.object({
    guestId: z.string(),
    source: BookingSourceEnum,
    status: z.enum(['tentative', 'confirmed']).default('tentative'),
    notes: z.string().max(2000).nullable().optional(),
    finalTotalKobo: Kobo.optional(),
    overrideReason: z.string().trim().min(3).max(300).optional(),
    acknowledgeIcalOverlap: z.boolean().optional(),
    capacityOverrideReason: z.string().trim().min(3).max(300).optional(),
  }),
).refine((b) => b.finalTotalKobo === undefined || !!b.overrideReason, {
  path: ['overrideReason'],
  message: 'Give a reason for changing the price',
});
export type CreateBookingInput = z.infer<typeof CreateBookingInput>;

export const UpdateBookingInput = z
  .object({
    unitId: z.string().optional(),
    checkIn: IsoDateSchema.optional(),
    checkOut: IsoDateSchema.optional(),
    guestCount: z.number().int().min(1).max(50).optional(),
    guestId: z.string().optional(),
    source: BookingSourceEnum.optional(),
    notes: z.string().max(2000).nullable().optional(),
    reprice: z.boolean().optional(),
    finalTotalKobo: Kobo.optional(),
    overrideReason: z.string().trim().min(3).max(300).optional(),
    acknowledgeIcalOverlap: z.boolean().optional(),
    capacityOverrideReason: z.string().trim().min(3).max(300).optional(),
  })
  .strict()
  .refine((b) => b.finalTotalKobo === undefined || !!b.overrideReason, {
    path: ['overrideReason'],
    message: 'Give a reason for changing the price',
  });
export type UpdateBookingInput = z.infer<typeof UpdateBookingInput>;

export const TransitionInput = z.object({
  to: z.enum(['confirmed', 'checked_in', 'checked_out', 'no_show']),
  reason: z.string().max(300).optional(),
});
export type TransitionInput = z.infer<typeof TransitionInput>;
// The refund (BKG-11) is recorded as a ledger entry in the same transaction as the cancellation.
export const CancelBookingInput = z
  .object({
    reason: z.string().trim().min(3).max(300),
    refundKobo: Kobo.optional(),
    refundMethod: z.enum(['bank_transfer', 'cash', 'pos', 'card', 'paystack', 'other']).optional(),
    refundReference: z.string().max(120).optional(),
  })
  .refine((c) => !c.refundKobo || !!c.refundMethod, { path: ['refundMethod'], message: 'How was the refund paid?' });
export type CancelBookingInput = z.infer<typeof CancelBookingInput>;

export const Booking = z.object({
  id: z.string(),
  ref: z.string(),
  unit: z.object({ id: z.string(), name: z.string(), propertyName: z.string(), maxGuests: z.number().int() }),
  guest: z.object({ id: z.string(), fullName: z.string(), phoneE164: z.string(), email: z.string().nullable() }),
  checkIn: z.string(),
  checkOut: z.string(),
  nights: z.number().int(),
  guestCount: z.number().int(),
  source: BookingSourceEnum,
  status: BookingStatus,
  holdUntil: z.string().nullable(),
  lines: z.array(PriceLineSchema),
  computedTotalKobo: z.number().int(),
  finalTotalKobo: z.number().int(),
  depositKobo: z.number().int(),
  overrideReason: z.string().nullable(),
  capacityOverrideReason: z.string().nullable(),
  priceStale: z.boolean(),
  icalWarningAck: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  history: z.array(
    z.object({
      from: BookingStatus.nullable(),
      to: BookingStatus,
      at: z.string(),
      actorName: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  ),
  // Filled by M3 (payments). null until then.
  paidKobo: z.number().int().nullable(),
  balanceKobo: z.number().int().nullable(),
  depositHeldKobo: z.number().int().nullable(),
});
export type Booking = z.infer<typeof Booking>;

export const BookingSummary = z.object({
  id: z.string(),
  ref: z.string(),
  unitName: z.string(),
  propertyName: z.string(),
  guestName: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  nights: z.number().int(),
  status: BookingStatus,
  source: BookingSourceEnum,
  finalTotalKobo: z.number().int(),
  balanceKobo: z.number().int().nullable(),
  holdUntil: z.string().nullable(),
});
export type BookingSummary = z.infer<typeof BookingSummary>;

export const BookingListQuery = z.object({
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  status: BookingStatus.optional(),
  unitId: z.string().optional(),
  source: BookingSourceEnum.optional(),
  q: z.string().trim().max(100).optional(),
  balanceDue: z.enum(['true', 'false']).optional(), // honoured from M3
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type BookingListQuery = z.infer<typeof BookingListQuery>;
