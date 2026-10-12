import { z } from 'zod';
import { BookingSummary } from './bookings';
import { IsoDateSchema } from './common';
import { PaymentMethod } from './payments';

export const MoneyQuery = z
  .object({ from: IsoDateSchema, to: IsoDateSchema, propertyId: z.string().optional() })
  .refine((q) => q.to > q.from, { path: ['to'], message: 'to must be after from' });
export const MoneySummary = z.object({
  receivedByMethod: z.array(z.object({ method: PaymentMethod, kobo: z.number().int() })),
  totalReceivedKobo: z.number().int(),
  refundsKobo: z.number().int(),
  depositsHeldKobo: z.number().int(),
  outstanding: z.array(BookingSummary),
  depositsToReturn: z.array(
    z.object({
      bookingId: z.string(),
      ref: z.string(),
      guestName: z.string(),
      unitName: z.string(),
      checkOut: z.string(),
      heldKobo: z.number().int(),
    }),
  ),
});
export type MoneySummary = z.infer<typeof MoneySummary>;
