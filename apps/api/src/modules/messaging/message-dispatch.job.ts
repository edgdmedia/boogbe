import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrgDb } from '../../common/db/org-db.service';
import { OrgInfo } from '../../common/db/org-info';
import { PrismaService } from '../../common/db/prisma.service';
import { JobRunner } from '../../common/jobs/job-runner';
import { MAILER } from '../../common/mail/mail.module';
import { MailInFlightError, type Mailer } from '../../common/mail/mailer';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';

/** Minutes to wait after failed attempt 1 and 2; attempt 3 failing is final. */
const BACKOFF_MIN = [1, 5];
const MAX_ATTEMPTS = 3;
const BATCH = 20;

/**
 * Sends the email outbox (MSG-03, MSG-05, MSG-06). `claim_outbound` (SECURITY DEFINER, 0007) leases due rows across
 * orgs with SKIP LOCKED and returns ids only; each send then reads its row under that org's RLS context.
 * A row whose result was never recorded (worker died, DB write failed, slow tick outlived the 10-minute lease) is
 * claimed again; the message id goes to the provider as an idempotency key, so the guest still gets one email.
 */
@Injectable()
export class MessageDispatchJob {
  /** Well under the 10-minute lease, so a hung provider call can't hold a whole batch past it. Tests lower it. */
  static sendTimeoutMs = 30_000;
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
    let r: { id: string | null };
    try {
      const org = await this.orgInfo.get(orgId);
      const attachments = msg.paymentId && this.mailer.delivers ? await this.receipt(orgId, msg.paymentId, id) : undefined;
      r = await withTimeout(
        this.mailer.send({
          to: msg.recipient,
          subject: msg.subject ?? '',
          text: msg.bodyText,
          html: msg.bodyHtml ?? msg.bodyText,
          fromName: org.name,
          replyTo: org.email ?? undefined,
          attachments,
          idempotencyKey: id,
        }),
        MessageDispatchJob.sendTimeoutMs,
      );
    } catch (e) {
      if (e instanceof MailInFlightError) {
        // An earlier attempt with this key is still with the provider: leave the row to its lease and look again then.
        this.log.warn(`message ${id}: an earlier send is still in progress; will check again after the lease`);
        return;
      }
      await this.recordFailure(orgId, msg, e);
      return;
    }
    // Recorded outside the send's try: once the provider took the mail, a failure here must never schedule a
    // resend or mark it failed. The row stays queued under its lease and the idempotency key absorbs any re-send.
    // Owner rule: never record `sent` unless a real provider took the mail.
    const data = this.mailer.delivers
      ? { status: 'sent', sentAt: new Date(), providerId: r.id, error: null }
      : { status: 'skipped_no_mailer', error: null };
    try {
      // `status: 'queued'`: a later tick that re-claimed this row may already have recorded it.
      await this.orgDb.run(orgId, (tx) => tx.outboundMessage.updateMany({ where: { id, status: 'queued' }, data }));
    } catch (e) {
      this.log.error(`message ${id} was handed to the mailer but its result was not recorded: ${String(e)}`);
    }
  }

  /** A missing or broken receipt must not hold back the email itself: send without it and log. */
  private async receipt(orgId: string, paymentId: string, id: string) {
    try {
      const r = await this.payments.receiptForOrg(orgId, paymentId);
      return [{ filename: r.filename, content: r.pdf }];
    } catch (e) {
      this.log.warn(`message ${id}: receipt for payment ${paymentId} unavailable, sending without it: ${String(e)}`);
      return undefined;
    }
  }

  private async recordFailure(
    orgId: string,
    msg: { id: string; attempts: number; recipient: string; bookingId: string | null },
    e: unknown,
  ) {
    const id = msg.id;
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await this.orgDb.run(orgId, async (tx) => {
      if (msg.attempts >= MAX_ATTEMPTS) {
        const { count } = await tx.outboundMessage.updateMany({ where: { id, status: 'queued' }, data: { status: 'failed', error } });
        if (!count) return; // another tick already recorded this message
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
        await tx.outboundMessage.updateMany({
          where: { id, status: 'queued' },
          data: { error, nextAttemptAt: new Date(Date.now() + wait) },
        });
      }
    });
    this.log.warn(`message ${id} attempt ${msg.attempts} failed: ${error}`);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('send timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
