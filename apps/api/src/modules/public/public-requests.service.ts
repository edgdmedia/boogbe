import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { formatNaira, nightsBetween, todayIn, type Booking, type BookingRequestInput } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AppError } from '../../common/http/app-error';
import { loadEnv } from '../../env';
import { BookingsService } from '../bookings/bookings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OutboxService } from '../messaging/outbox.service';
import { VarsService } from '../messaging/vars.service';
import { PublicOrgService, type PublicOrg } from './public-org.service';
import { invalidDates } from './public-read.service';
import { TURNSTILE_VERIFIER, type TurnstileVerifier } from './turnstile';
import { teamEmail } from './website-mail';
import { WebsiteEmailsService } from './website-emails.service';

/**
 * `POST /v1/public/:slug/requests` (WB, spec §5): a guest's request becomes a tentative `website` booking held for
 * `public_hold_minutes`, with an in-app notification and emails queued in the same transaction (outbox), so a mail
 * outage never fails the request. WebsiteEmailsService sends the guest the confirmed / not-confirmed email later.
 */
@Injectable()
export class PublicRequestsService {
  private readonly env = loadEnv();
  constructor(
    private readonly orgDb: OrgDb,
    private readonly orgs: PublicOrgService,
    private readonly bookings: BookingsService,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
    private readonly emails: WebsiteEmailsService,
    private readonly vars: VarsService,
    @Inject(TURNSTILE_VERIFIER) private readonly turnstile: TurnstileVerifier,
  ) {}

  async create(slug: string, input: BookingRequestInput, ip: string | undefined) {
    const org: PublicOrg = await this.orgs.resolve(slug);
    if (input.checkIn < todayIn(org.timezone)) throw invalidDates('Dates must be today or later');
    const check = await this.turnstile.verify(input.turnstileToken, ip);
    // A token solved on another site is no proof the guest used this operator's form.
    const hosts = org.origins.map((o) => new URL(o).hostname);
    if (!check.success || !check.hostname || !hosts.includes(check.hostname))
      throw new AppError('VERIFICATION_FAILED', 400, 'We could not verify the request. Please try again.');
    return this.orgDb.run(org.orgId, async (tx) => {
      await this.orgs.listedUnit(tx, input.unitId);
      const guestId = await this.upsertGuest(tx, input);
      const b = await this.bookings.createIn(
        tx,
        null,
        { orgId: org.orgId, timezone: org.timezone },
        {
          unitId: input.unitId,
          guestId,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          guestCount: input.guests,
          source: 'website',
          status: 'tentative',
          notes: [`Website request${input.email ? ` (email given: ${input.email})` : ''}`, input.note].filter(Boolean).join(': '),
        },
        { holdMinutes: org.holdMinutes, ip: ip ? this.ipHash(ip) : undefined },
      );
      await this.notifyTeam(tx, org, b, input);
      // To the address typed in this form, which may not be (and never becomes) the guest's recorded email.
      if (input.email) await this.emails.send(tx, b, 'website_request_received', `website_request_received-${b.id}`, input.email);
      return { ref: b.ref, holdUntil: b.holdUntil!, totalKobo: b.finalTotalKobo };
    });
  }

  /** Keyed hash: the audit log can tell repeat requests apart without ever storing a guest's IP address. */
  private ipHash(ip: string) {
    return createHmac('sha256', this.env.BETTER_AUTH_SECRET).update(`public-ip:${ip}`).digest('hex').slice(0, 32);
  }

  /**
   * Reuse the guest with this phone, leaving their recorded details alone. Writing a typed email onto a known guest
   * would let anyone who knows a guest's phone number redirect that guest's future emails (receipts, check-in codes),
   * so a public form only sets contact details on a guest it creates (deviation from spec §5 "update email if empty").
   */
  private async upsertGuest(tx: OrgTx, input: BookingRequestInput): Promise<string> {
    const g = await tx.guest.findFirst({
      where: { phoneE164: input.phone, anonymisedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (g) {
      return g.id;
    }
    const id = newId();
    await tx.guest.create({
      data: { id, fullName: input.fullName, phoneE164: input.phone, email: input.email ?? null } as never,
    });
    return id;
  }

  private async notifyTeam(tx: OrgTx, org: PublicOrg, b: Booking, input: BookingRequestInput) {
    await this.notifications.notifyRoles(tx, org.orgId, ['admin', 'frontdesk'], {
      kind: 'website_request',
      title: `Website request: ${b.ref}`,
      body: `${b.unit.name}, ${b.checkIn} – ${b.checkOut}`,
      link: `/bookings/${b.id}`,
      dedupeKey: `website_request:${b.id}`,
    });
    const v = await this.vars.forBooking(tx, org.orgId, b.id);
    const o = await tx.organization.findFirstOrThrow({ where: { id: org.orgId }, select: { contactEmail: true } });
    const s = await tx.orgSettings.findFirstOrThrow();
    const to = [...new Set([o.contactEmail, ...s.notifyEmails].filter((x): x is string => !!x).map((x) => x.toLowerCase()))];
    const m = teamEmail(
      {
        id: b.id,
        ref: b.ref,
        unitName: v['unit.name'],
        propertyName: v['property.name'],
        checkIn: v['booking.checkIn'],
        checkOut: v['booking.checkOut'],
        nights: nightsBetween(b.checkIn, b.checkOut),
        guests: b.guestCount,
        total: formatNaira(b.finalTotalKobo),
        guestName: input.fullName,
        phone: input.phone,
        email: input.email,
        note: input.note,
        holdUntil: v['booking.holdUntil'],
      },
      { appOrigin: this.env.APP_ORIGIN },
    );
    for (const addr of to)
      await this.outbox.queueEmail(tx, {
        bookingId: b.id,
        to: addr,
        subject: m.subject,
        bodyMarkdown: m.bodyMarkdown,
        dedupeKey: `website_request_team-${b.id}-${addr}`,
      });
  }
}
