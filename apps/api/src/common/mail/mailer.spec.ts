import { describe, expect, it, vi } from 'vitest';
import { MailInFlightError, ResendMailer } from './mailer';

const MSG = { to: 'ada@example.ng', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi', idempotencyKey: 'msg-1' };

function mailer(result: { data: { id: string } | null; error: { name: string; message: string } | null }) {
  const m = new ResendMailer('re_test', 'Boogbe <mail@boogbe.com>');
  const send = vi.fn().mockResolvedValue(result);
  (m as unknown as { client: unknown }).client = { emails: { send } };
  return { m, send };
}

describe('ResendMailer', () => {
  it('passes the idempotency key to Resend', async () => {
    const { m, send } = mailer({ data: { id: 're-1' }, error: null });
    expect(await m.send(MSG)).toEqual({ id: 're-1' });
    expect(send.mock.calls[0]![1]).toEqual({ idempotencyKey: 'msg-1' });
  });

  it('a key Resend already accepted (409 invalid_idempotent_request) counts as delivered, not failed', async () => {
    const { m } = mailer({ data: null, error: { name: 'invalid_idempotent_request', message: 'payload changed' } });
    expect(await m.send(MSG)).toEqual({ id: null, alreadyAccepted: true });
  });

  it('a send still in flight with the same key (409 concurrent_idempotent_requests) is neither sent nor failed', async () => {
    const { m } = mailer({ data: null, error: { name: 'concurrent_idempotent_requests', message: 'in progress' } });
    await expect(m.send(MSG)).rejects.toBeInstanceOf(MailInFlightError);
  });

  it('any other provider error is a failure', async () => {
    const { m } = mailer({ data: null, error: { name: 'validation_error', message: 'bad to' } });
    await expect(m.send(MSG)).rejects.toThrow('resend: bad to');
  });
});
