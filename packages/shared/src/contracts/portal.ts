import { z } from 'zod';
import { StatementSummary } from './statements';

export const PortalSummary = z.object({
  owner: z.object({ id: z.string(), name: z.string() }), month: z.string(),
  units: z.array(z.object({ id: z.string(), name: z.string(), propertyName: z.string(), occupancyPct: z.number().min(0).max(100), revenueMtdKobo: z.number().int() })),
  upcoming: z.array(z.object({ unitName: z.string(), checkIn: z.string(), checkOut: z.string(), nights: z.number().int(), guestName: z.string().nullable() })),
  statements: z.array(StatementSummary),
});
export type PortalSummary = z.infer<typeof PortalSummary>;
