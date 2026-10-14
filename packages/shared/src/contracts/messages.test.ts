import { describe, expect, it } from 'vitest';
import { MESSAGE_STATUS_LABELS, MessageLogEntry, MessageStatus } from './messages';

const entry = {
  id: 'm1',
  templateKey: 'booking_confirmation',
  channel: 'email',
  recipient: 'guest@example.com',
  subject: 'Your booking',
  attempts: 0,
  error: null,
  actorName: null,
  createdAt: '2026-10-14T09:00:00Z',
  sentAt: null,
};

describe('message status [MSG-05]', () => {
  it('an email that was never sent because no mailer is set up has its own status', () => {
    expect(MessageLogEntry.parse({ ...entry, status: 'skipped_no_mailer' }).status).toBe('skipped_no_mailer');
    expect(MessageLogEntry.safeParse({ ...entry, status: 'delivered' }).success).toBe(false);
  });

  it('every status has a label, and the no-mailer one never claims it was sent', () => {
    expect(Object.keys(MESSAGE_STATUS_LABELS).sort()).toEqual([...MessageStatus.options].sort());
    expect(MESSAGE_STATUS_LABELS.skipped_no_mailer).toBe('Not sent (email not set up)');
    expect(MESSAGE_STATUS_LABELS.sent).toBe('Sent');
  });
});
