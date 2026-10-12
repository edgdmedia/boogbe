import { z } from 'zod';
import { Kobo } from './common';
import { PaymentMethod } from './payments';

export const Channel = z.enum(['airbnb', 'booking_com', 'vrbo', 'other']);
export type Channel = z.infer<typeof Channel>;
export const CHANNEL_LABELS: Record<Channel | 'all', string> = {
  airbnb: 'Airbnb',
  booking_com: 'Booking.com',
  vrbo: 'VRBO',
  other: 'Other',
  all: 'All channels',
};

/** Import feed (ICS-01). The server additionally refuses hosts that resolve to private addresses (T-M4-03). */
export const IcalFeedInput = z.object({
  unitId: z.string(),
  label: z.string().trim().min(2).max(60),
  channel: Channel,
  url: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((u) => u.startsWith('https://'), 'Use the https:// calendar link'),
});
export type IcalFeedInput = z.infer<typeof IcalFeedInput>;

export const IcalFeed = z.object({
  id: z.string(),
  unitId: z.string(),
  label: z.string(),
  channel: Channel,
  urlHost: z.string(),
  lastSyncedAt: z.string().nullable(),
  lastAttemptAt: z.string().nullable(),
  lastStatus: z.enum(['ok', 'error', 'never']),
  lastError: z.string().nullable(),
  consecutiveFailures: z.number().int(),
  active: z.boolean(),
  blockCount: z.number().int(),
});
export type IcalFeed = z.infer<typeof IcalFeed>;

export const ExportChannel = z.union([Channel, z.literal('all')]);
export type ExportChannel = z.infer<typeof ExportChannel>;
export const CreateExportInput = z.object({ unitId: z.string(), channel: ExportChannel });
export type CreateExportInput = z.infer<typeof CreateExportInput>;
export const IcalExport = z.object({
  id: z.string(),
  unitId: z.string(),
  channel: ExportChannel,
  url: z.string().url(),
  excludeFeedId: z.string().nullable(),
  createdAt: z.string(),
  rotatedAt: z.string().nullable(),
});
export type IcalExport = z.infer<typeof IcalExport>;

export const ConflictResolution = z.enum(['external', 'cancelled_booking', 'moved_booking', 'cleared']);
export type ConflictResolution = z.infer<typeof ConflictResolution>;
export const SyncConflict = z.object({
  id: z.string(),
  status: z.enum(['open', 'resolved']),
  resolution: ConflictResolution.nullable(),
  unit: z.object({ id: z.string(), name: z.string() }),
  booking: z.object({
    id: z.string(),
    ref: z.string(),
    guestName: z.string(),
    checkIn: z.string(),
    checkOut: z.string(),
    status: z.string(),
  }),
  block: z.object({
    id: z.string(),
    start: z.string(),
    end: z.string(),
    summary: z.string(),
    channel: Channel.nullable(),
  }),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type SyncConflict = z.infer<typeof SyncConflict>;

export const ResolveConflictInput = z
  .object({
    action: z.enum(['external', 'cancel_booking', 'moved_booking']),
    refundKobo: Kobo.optional(),
    refundMethod: PaymentMethod.optional(),
  })
  .refine((r) => !r.refundKobo || !!r.refundMethod, {
    path: ['refundMethod'],
    message: 'How was the refund paid?',
  });
export type ResolveConflictInput = z.infer<typeof ResolveConflictInput>;

export const SyncResult = z.object({
  status: z.enum(['ok', 'not_modified', 'error']),
  added: z.number().int(),
  updated: z.number().int(),
  removed: z.number().int(),
  error: z.string().nullable(),
});
export type SyncResult = z.infer<typeof SyncResult>;
