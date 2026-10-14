import { Logger } from '@nestjs/common';
import { Resend } from 'resend';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  fromName?: string;
}
export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

export class ResendMailer implements Mailer {
  private readonly client: Resend;
  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }
  async send(m: MailMessage) {
    const from = m.fromName ? `${m.fromName} via Boogbe <${this.from.match(/<(.+)>/)?.[1] ?? this.from}>` : this.from;
    const { error } = await this.client.emails.send({
      from,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
      replyTo: m.replyTo,
    });
    if (error) throw new Error(`resend: ${error.message}`);
  }
}

/** Dev/test mailer: keeps messages in memory and logs them. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  private readonly log = new Logger('MemoryMailer');
  async send(m: MailMessage) {
    this.sent.push(m);
    if (process.env.NODE_ENV === 'development') this.log.log(`to=${m.to} subject="${m.subject}"\n${m.text}`);
  }
  lastTo(email: string) {
    return [...this.sent].reverse().find((m) => m.to === email);
  }
}
