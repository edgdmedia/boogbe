import { Logger } from '@nestjs/common';
import { Resend } from 'resend';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  fromName?: string;
  attachments?: { filename: string; content: Buffer }[];
  /** Provider-side dedupe (Resend keeps keys 24 h): a re-sent message with the same key is accepted once. */
  idempotencyKey?: string;
}
/** `alreadyAccepted`: the provider had already taken a message with this idempotency key (an earlier attempt got through). */
export type MailResult = { id: string | null; alreadyAccepted?: true };
export interface Mailer {
  /** False for the in-memory mailer: nothing leaves the process, so the outbox must not record mail as sent. */
  readonly delivers: boolean;
  send(msg: MailMessage): Promise<MailResult>;
}

/** Another request with the same idempotency key is still in progress: neither sent nor failed yet. */
export class MailInFlightError extends Error {
  constructor() {
    super('a send with this idempotency key is still in progress');
  }
}

export class ResendMailer implements Mailer {
  readonly delivers = true;
  private readonly client: Resend;
  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }
  async send(m: MailMessage): Promise<MailResult> {
    const from = m.fromName ? `${m.fromName} via Boogbe <${this.from.match(/<(.+)>/)?.[1] ?? this.from}>` : this.from;
    const { data, error } = await this.client.emails.send(
      {
        from,
        to: m.to,
        subject: m.subject,
        html: m.html,
        text: m.text,
        replyTo: m.replyTo,
        attachments: m.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
      },
      m.idempotencyKey ? { idempotencyKey: m.idempotencyKey } : undefined,
    );
    // Resend's 409s for a reused key (https://resend.com/docs/api-reference/errors): a different body under a key it
    // already accepted means an earlier attempt was delivered; a concurrent one means it may still be.
    if (error?.name === 'invalid_idempotent_request') return { id: null, alreadyAccepted: true };
    if (error?.name === 'concurrent_idempotent_requests') throw new MailInFlightError();
    if (error) throw new Error(`resend: ${error.message}`);
    return { id: data?.id ?? null };
  }
}

/** Dev/test mailer: keeps messages in memory and logs them. */
export class MemoryMailer implements Mailer {
  readonly delivers: boolean = false;
  readonly sent: MailMessage[] = [];
  private readonly log = new Logger('MemoryMailer');
  private failures = 0;
  private n = 0;
  /** Tests: the next `n` sends throw, as a provider outage would. */
  failNext(n: number) {
    this.failures = n;
  }
  async send(m: MailMessage): Promise<MailResult> {
    if (this.failures > 0) {
      this.failures--;
      throw new Error('simulated outage');
    }
    this.sent.push(m);
    if (process.env.NODE_ENV === 'development') this.log.log(`to=${m.to} subject="${m.subject}"\n${m.text}`);
    return { id: `mem-${++this.n}` };
  }
  lastTo(email: string) {
    return [...this.sent].reverse().find((m) => m.to === email);
  }
}
