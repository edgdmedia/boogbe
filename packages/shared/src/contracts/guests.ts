import { z } from 'zod';
import { E164 } from './common';

export const GuestInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  phoneE164: E164,
  email: z.string().email().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type GuestInput = z.infer<typeof GuestInput>;
export const Guest = z.object({
  id: z.string(),
  fullName: z.string(),
  phoneE164: z.string(),
  email: z.string().nullable(),
  notes: z.string().nullable(),
  bookingCount: z.number().int(),
  lifetimeValueKobo: z.number().int(),
  lastStayAt: z.string().nullable(),
});
export type Guest = z.infer<typeof Guest>;
export const GuestListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const GuestMatchQuery = z.object({ phone: E164.optional(), email: z.string().email().optional() });
