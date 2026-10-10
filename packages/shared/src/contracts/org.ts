import { z } from 'zod';
import { E164 } from './platform';

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const Prefix = z.string().regex(/^[A-Z0-9]{2,6}$/, '2–6 capital letters or digits');

export const OrgSettingsResponse = z.object({
  org: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    currency: z.string(),
    contactEmail: z.string().nullable(),
    contactPhone: z.string().nullable(),
    whatsappPhone: z.string().nullable(),
    address: z.string().nullable(),
  }),
  settings: z.object({
    checkInTime: Time,
    checkOutTime: Time,
    holdHours: z.number().int(),
    autoConfirmOnPayment: z.boolean(),
    ownerSeesGuestNames: z.boolean(),
    receiptPrefix: Prefix,
    statementPrefix: Prefix,
    bookingPrefix: Prefix,
  }),
});
export type OrgSettingsResponse = z.infer<typeof OrgSettingsResponse>;

export const UpdateOrgSettingsInput = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    contactEmail: z.string().email().nullable().optional(),
    contactPhone: E164.nullable().optional(),
    whatsappPhone: E164.nullable().optional(),
    address: z.string().max(300).nullable().optional(),
    checkInTime: Time.optional(),
    checkOutTime: Time.optional(),
    holdHours: z.number().int().min(1).max(168).optional(),
    autoConfirmOnPayment: z.boolean().optional(),
    ownerSeesGuestNames: z.boolean().optional(),
    receiptPrefix: Prefix.optional(),
    statementPrefix: Prefix.optional(),
    bookingPrefix: Prefix.optional(),
  })
  .strict();
export type UpdateOrgSettingsInput = z.infer<typeof UpdateOrgSettingsInput>;
