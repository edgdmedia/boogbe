import { Inject, Injectable, Logger } from '@nestjs/common';
import { MAILER } from '../../common/mail/mail.module';
import type { Mailer } from '../../common/mail/mailer';
import { loadEnv } from '../../env';

/** Email copies of critical alerts (NTF-02). A failed send is logged, never thrown, so it can't undo the alert. */
@Injectable()
export class AlertMailer {
  private readonly log = new Logger('AlertMailer');
  constructor(@Inject(MAILER) private readonly mailer: Mailer) {}

  async send(to: string[], subject: string, text: string, link?: string) {
    const url = link ? `${loadEnv().APP_ORIGIN}${link}` : null;
    const body = url ? `${text}\n\nOpen in Boogbe: ${url}` : text;
    const html = `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>`;
    for (const email of to) {
      try {
        await this.mailer.send({ to: email, subject, text: body, html });
      } catch (e) {
        this.log.error(`alert to ${email} failed: ${String(e)}`);
      }
    }
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
