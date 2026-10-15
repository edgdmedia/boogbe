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
export interface Mailer {
  /** False for the in-memory mailer: nothing leaves the process, so the outbox must not record mail as sent. */
  readonly delivers: boolean;
  send(msg: MailMessage): Promise<{ id: string | null }>;
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
  async send(m: MailMessage) {
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
  async send(m: MailMessage) {
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
