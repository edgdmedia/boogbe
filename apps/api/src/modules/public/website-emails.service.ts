import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import type { Booking, TemplateKey } from '@boogbe/shared';
import type { OrgTx } from '../../common/db/org-db.service';
import { BookingHooks } from '../bookings/booking-hooks';
import { BookingsModule } from '../bookings/bookings.module';
import { MessagingModule } from '../messaging/messaging.module';
import { OutboxService } from '../messaging/outbox.service';
import { TemplatesService } from '../messaging/templates.service';
import { VarsService } from '../messaging/vars.service';

/**
 * Guest emails for website requests (spec §6). Its hooks must run wherever a booking transitions: in the API
 * (front desk confirms or declines) and in the worker (booking-holds.job expires the hold), so this module is
 * imported by both PublicModule and WorkerModule.
 */
@Injectable()
export class WebsiteEmailsService implements OnModuleInit {
  constructor(
    private readonly hooks: BookingHooks,
    private readonly outbox: OutboxService,
    private readonly templates: TemplatesService,
    private readonly vars: VarsService,
  ) {}

  onModuleInit() {
    this.hooks.register({
      afterTransition: async (tx, _ctx, b, from) => {
        if (b.source !== 'website' || from !== 'tentative') return;
        // Same dedupe key T-M5-05's automatic confirmation will use, so the guest is never sent it twice (plan deviation 1).
        if (b.status === 'confirmed') await this.send(tx, b, 'booking_confirmation', `auto-booking_confirmation-${b.id}`);
        // Declined by the front desk, or the hold expired (booking-holds.job): the dates are released.
        if (b.status === 'cancelled') await this.send(tx, b, 'website_request_closed', `website_request_closed-${b.id}`);
      },
    });
  }

  /**
   * To the guest's recorded email, or to `typed.to` with the name typed in the form (a website request for a known
   * guest must not tell the typed address who that guest is). Skipped when there is no address, or while the
   * operator has the template switched off or set to manual.
   */
  async send(tx: OrgTx, b: Booking, key: TemplateKey, dedupeKey: string, typed?: { to: string; guestName: string }) {
    const recipient = typed?.to ?? (await tx.guest.findFirst({ where: { id: b.guest.id }, select: { email: true } }))?.email;
    if (!recipient) return;
    const tpl = await this.templates.getIn(tx, key);
    if (!tpl.active || !tpl.autoEmail) return;
    const orgId = (await tx.$queryRaw<{ o: string }[]>`SELECT app_current_org() AS o`)[0]!.o;
    const vars = await this.vars.forBooking(tx, orgId, b.id);
    if (typed) {
      const name = typed.guestName.trim();
      vars['guest.fullName'] = name;
      vars['guest.firstName'] = name.split(/\s+/)[0] || name;
    }
    await this.outbox.queueEmail(tx, {
      bookingId: b.id,
      templateKey: key,
      to: recipient,
      subject: tpl.emailSubject,
      bodyMarkdown: tpl.emailBody,
      vars,
      dedupeKey,
    });
  }
}

@Module({
  imports: [BookingsModule, MessagingModule],
  providers: [WebsiteEmailsService],
  exports: [WebsiteEmailsService],
})
export class WebsiteEmailsModule {}
