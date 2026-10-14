import { z } from 'zod';
import { ORG_ROLES } from '../enums';

export const MeResponse = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string(), isPlatformAdmin: z.boolean() }),
  activeOrg: z
    .object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      role: z.enum(ORG_ROLES),
      timezone: z.string(),
      currency: z.string(),
    })
    .nullable(),
  memberships: z.array(z.object({ orgId: z.string(), orgName: z.string(), role: z.enum(ORG_ROLES) })),
});
export type MeResponse = z.infer<typeof MeResponse>;
