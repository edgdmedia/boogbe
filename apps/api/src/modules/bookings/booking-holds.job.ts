import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrgDb } from '../../common/db/org-db.service';
import { JobRunner } from '../../common/jobs/job-runner';
import { newId } from '../../common/db/ids';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingHooks } from './booking-hooks';
import { BookingsService } from './bookings.service';

/** Releases tentative bookings whose hold has expired (BKG-08). */
@Injectable()
export class BookingHoldsJob {
  constructor(
    private readonly runner: JobRunner,
    private readonly orgDb: OrgDb,
    private readonly notifications: NotificationsService,
    private readonly bookings: BookingsService,
    private readonly hooks: BookingHooks,
  ) {}

  @Cron('*/10 * * * *')
  async tick() {
    await this.run();
  }

  async run(now = new Date()) {
    return this.runner.forEachActiveOrg('bookings.expireHolds', (org) =>
      this.orgDb.run(org.id, async (tx) => {
        // One conditional UPDATE: a booking confirmed (or paid) a moment ago no longer matches and is skipped.
        const expired = await tx.$queryRaw<
          { id: string; ref: string; created_by_member_id: string | null }[]
        >`
          UPDATE booking SET status = 'cancelled', hold_until = NULL, cancelled_at = ${now}, cancel_reason = 'hold_expired', updated_at = ${now}
          WHERE status = 'tentative' AND hold_until < ${now}
          RETURNING id, ref, created_by_member_id`;
        for (const b of expired) {
          await tx.bookingStatusEvent.create({
            data: {
              id: newId(),
              bookingId: b.id,
              fromStatus: 'tentative',
              toStatus: 'cancelled',
              reason: 'hold_expired',
            } as never,
          });
          if (b.created_by_member_id) {
            await this.notifications.notifyMember(tx, org.id, b.created_by_member_id, {
              kind: 'hold_expired',
              title: `Hold expired: ${b.ref}`,
              body: 'The tentative booking was released because it was not confirmed in time.',
              link: `/bookings/${b.id}`,
              dedupeKey: `hold_expired:${b.id}`,
            });
          }
          await this.hooks.run(
            'afterTransition',
            tx,
            null,
            await this.bookings.getIn(tx, org.id, b.id),
            'tentative',
          );
        }
      }),
    );
  }
}
