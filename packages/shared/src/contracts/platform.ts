import { z } from 'zod';
import { ORG_ROLES, ORG_STATUSES } from '../enums';

export const E164 = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +2348012345678');
export const Slug = z.string().regex(/^[a-z0-9-]{3,40}$/, 'Lowercase letters, numbers and dashes (3–40)');

export const CreateOperatorInput = z.object({
  name: z.string().trim().min(2).max(80),
  slug: Slug,
  timezone: z.string().default('Africa/Lagos'),
  contactEmail: z.string().email().optional(),
  contactPhone: E164.optional(),
  whatsappPhone: E164.optional(),
});
export type CreateOperatorInput = z.infer<typeof CreateOperatorInput>;

export const Operator = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(ORG_STATUSES),
  timezone: z.string(),
  currency: z.string(),
  createdAt: z.string(),
  memberCount: z.number().int(),
  pendingInvites: z.number().int(),
});
export type Operator = z.infer<typeof Operator>;

export const OperatorDetail = Operator.extend({
  members: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      role: z.enum(ORG_ROLES),
      createdAt: z.string(),
    }),
  ),
  invitations: z.array(
    z.object({ id: z.string(), email: z.string(), role: z.string(), status: z.string(), expiresAt: z.string() }),
  ),
});
export type OperatorDetail = z.infer<typeof OperatorDetail>;

export const InviteFirstAdminInput = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
});
export type InviteFirstAdminInput = z.infer<typeof InviteFirstAdminInput>;

export const PublicInvitation = z.object({
  id: z.string(),
  email: z.string(),
  orgName: z.string(),
  role: z.enum(ORG_ROLES),
  status: z.string(),
  expired: z.boolean(),
  userExists: z.boolean(),
});
export type PublicInvitation = z.infer<typeof PublicInvitation>;
