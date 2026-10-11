import { z } from 'zod';

export const AuditQuery = z.object({
  entity: z.string().optional(),
  entityId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const AuditEntry = z.object({
  id: z.string(),
  at: z.string(),
  actorName: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;
