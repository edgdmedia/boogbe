import { z } from 'zod';
import { E164 } from './common';

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const Prefix = z.string().regex(/^[A-Z0-9]{2,6}$/, '2–6 capital letters or digits');

/**
 * An operator website origin for CORS on public booking routes: https (http only for localhost while developing),
 * reduced to scheme+host+port. Other schemes give the origin "null", which sandboxed iframes and file:// pages send.
 */
const toUrl = (u: string) => {
  try {
    return new URL(u);
  } catch {
    return null; // zod runs refinements and transforms even after .url() fails
  }
};
const WebsiteOrigin = z
  .string()
  .url()
  .refine((u) => {
    const x = toUrl(u);
    return !!x && (x.protocol === 'https:' || (x.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(x.hostname)));
  }, 'Use your website address, starting with https://')
  .transform((u) => toUrl(u)?.origin ?? u);

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
    logoUrl: z.string().url().nullable(),
    publicEnabled: z.boolean(),
    publicHoldMinutes: z.number().int(),
    publicOrigins: z.array(z.string()),
    publicSiteUrl: z.string().nullable(),
    notifyEmails: z.array(z.string()),
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
    logoFileId: z.string().nullable().optional(),
    // Online booking (WB). Origins are stored as bare origins so the CORS check is an exact match.
    publicEnabled: z.boolean().optional(),
    publicHoldMinutes: z.number().int().min(15).max(1440).optional(),
    publicOrigins: z.array(WebsiteOrigin).max(5).optional(),
    publicSiteUrl: z.string().url().startsWith('https://').nullable().optional(),
    notifyEmails: z.array(z.string().email()).max(5).optional(),
  })
  .strict();
export type UpdateOrgSettingsInput = z.infer<typeof UpdateOrgSettingsInput>;
