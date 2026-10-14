import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrgDb } from '../../common/db/org-db.service';
import { OrgInfo } from '../../common/db/org-info';
import { PrismaService } from '../../common/db/prisma.service';
import { JobRunner } from '../../common/jobs/job-runner';
import { MAILER } from '../../common/mail/mail.module';
import type { Mailer } from '../../common/mail/mailer';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';

/** Minutes to wait after failed attempt 1 and 2; attempt 3 failing is final. */
const BACKOFF_MIN = [1, 5];
const MAX_ATTEMPTS = 3;
const BATCH = 20;

/**
 * Sends the email outbox (MSG-03, MSG-05, MSG-06). `claim_outbound` (SECURITY DEFINER, 0007) leases due rows across
 * orgs with SKIP LOCKED and returns ids only; each send then reads its row under that org's RLS context.
 * Delivery is at-least-once: a worker that dies between sending and recording `sent` resends after the 10-minute lease.
 */
@Injectable()
export class MessageDispatchJob {
  private readonly log = new Logger('MessageDispatch');
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgDb: OrgDb,
    private readonly orgInfo: OrgInfo,
    private readonly runner: JobRunner,
    private readonly notifications: NotificationsService,
    private readonly payments: PaymentsService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  @Cron('* * * * *')
  async tick() {
    await this.runner.once('messaging.dispatch', () => this.run());
  }

  async run() {
    const claimed = await this.prisma.$queryRaw<{ id: string; org_id: string }[]>`SELECT * FROM claim_outbound(${BATCH}::int)`;
    for (const c of claimed) await this.sendOne(c.org_id, c.id);
  }

  private async sendOne(orgId: string, id: string) {
    const msg = await this.orgDb.run(orgId, (tx) => tx.outboundMessage.findFirst({ where: { id } }));
    if (!msg || msg.status !== 'queued') return;
    try {
      const org = await this.orgInfo.get(orgId);
      const attachments =
        msg.paymentId && this.mailer.delivers
          ? [await this.payments.receiptForOrg(orgId, msg.paymentId)].map((r) => ({ filename: r.filename, content: r.pdf }))
          : undefined;
      const r = await this.mailer.send({
        to: msg.recipient,
        subject: msg.subject ?? '',
        text: msg.bodyText,
        html: msg.bodyHtml ?? msg.bodyText,
        fromName: org.name,
        replyTo: org.email ?? undefined,
        attachments,
      });
      // Owner rule: never record `sent` unless a real provider took the mail.
      const data = this.mailer.delivers
        ? { status: 'sent', sentAt: new Date(), providerId: r.id, error: null }
        : { status: 'skipped_no_mailer', error: null };
      await this.orgDb.run(orgId, (tx) => tx.outboundMessage.updateMany({ where: { id }, data }));
    } catch (e) {
      const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await this.orgDb.run(orgId, async (tx) => {
        if (msg.attempts >= MAX_ATTEMPTS) {
          await tx.outboundMessage.updateMany({ where: { id }, data: { status: 'failed', error } });
          await this.notifications.notifyRoles(tx, orgId, ['admin', 'frontdesk'], {
            kind: 'message_failed',
            title: `Email to ${msg.recipient} failed`,
            body: error,
            link: msg.bookingId ? `/bookings/${msg.bookingId}` : undefined,
            dedupeKey: `message-failed-${id}`,
          });
        } else {
          // claim_outbound already counted this attempt, so attempts is the attempt that just failed.
          const wait = BACKOFF_MIN[msg.attempts - 1]! * 60_000;
          await tx.outboundMessage.updateMany({ where: { id }, data: { error, nextAttemptAt: new Date(Date.now() + wait) } });
        }
      });
      this.log.warn(`message ${id} attempt ${msg.attempts} failed: ${error}`);
    }
  }
}
