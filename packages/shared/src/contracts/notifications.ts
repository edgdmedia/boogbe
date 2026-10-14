import { z } from 'zod';

export const NotificationKind = z.enum([
  'hold_expired',
  'ical_conflict',
  'ical_feed_failing',
  'statements_ready',
  'task_issue',
  'message_failed',
]);
export const Notification = z.object({
  id: z.string(),
  kind: NotificationKind,
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof Notification>;
export const NotificationList = z.object({ items: z.array(Notification), unreadCount: z.number().int() });
