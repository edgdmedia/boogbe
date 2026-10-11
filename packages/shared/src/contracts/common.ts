import { z } from 'zod';
import { isIsoDate } from '../domain/dates';

export const IsoDateSchema = z.string().refine(isIsoDate, 'Use YYYY-MM-DD');
export const Kobo = z.number().int('Must be whole kobo').min(0).max(Number.MAX_SAFE_INTEGER);
export const Bps = z.number().int().min(0).max(10_000);
export const E164 = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +2348012345678');
export const Page = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() });
export const CursorQuery = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
