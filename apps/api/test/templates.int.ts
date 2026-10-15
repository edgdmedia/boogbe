import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { OrgDb } from '../src/common/db/org-db.service';
import { VarsService } from '../src/modules/messaging/vars.service';

describe('templates [MSG-01 MSG-02]', () => {
  let t: TestApp;
  let admin: Agent;
  let orgId: string;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll();
    orgId = (await seedOrg('Tanuhomes')).id;
    const m = await migratorClient();
    await m.query(
      `insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'T','T','T',now())`,
      [orgId],
    );
    await m.end();
    admin = (await signInAs(t, 'admin', orgId)).agent;
  });

  it('lists every default on first use, including the website request emails', async () => {
    const r = (await admin.get('/v1/templates').expect(200)).body.items;
    expect(r.map((x: { key: string }) => x.key)).toEqual([
      'booking_confirmation',
      'payment_receipt',
      'check_in_details',
      'pre_arrival_reminder',
      'post_checkout_thanks',
      'deposit_returned',
      'website_request_received',
      'website_request_closed',
    ]);
    // Listing twice doesn't duplicate the defaults.
    expect((await admin.get('/v1/templates').expect(200)).body.items).toHaveLength(8);
  });

  it('rejects unknown placeholders and saves valid edits', async () => {
    const base = { emailSubject: 'Hi', emailBody: 'Hello {{guest.nickname}}', whatsappBody: 'x', autoEmail: true, active: true };
    const bad = await admin.put('/v1/templates/booking_confirmation').send(base);
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('{{guest.nickname}}');
    const ok = (
      await admin
        .put('/v1/templates/booking_confirmation')
        .send({ ...base, emailBody: 'Hello {{guest.firstName}}', autoEmail: false })
        .expect(200)
    ).body;
    expect(ok).toMatchObject({ key: 'booking_confirmation', emailBody: 'Hello {{guest.firstName}}', autoEmail: false });
    const listed = (await admin.get('/v1/templates').expect(200)).body.items[0];
    expect(listed).toMatchObject({ emailBody: 'Hello {{guest.firstName}}', autoEmail: false });
    await admin.put('/v1/templates/not_a_template').send({ ...base, emailBody: 'x' }).expect(400);
  });

  it('previews with sample data and the real operator name', async () => {
    const r = (
      await admin
        .post('/v1/templates/preview')
        .send({ emailSubject: '{{operator.name}}', emailBody: 'Hi **{{guest.firstName}}**', whatsappBody: '{{booking.ref}}' })
        .expect(200)
    ).body;
    expect(r).toEqual({ emailSubject: 'Tanuhomes', emailHtml: '<p>Hi <strong>Adaeze</strong></p>', whatsappText: 'TAN-2610-0042' });
  });

  it('placeholder values are plain text in the email preview — they never add formatting or links', async () => {
    const m = await migratorClient();
    await m.query(`update organization set name=$2 where id=$1`, [orgId, '**Sun** & [Book](https://x.co) <b>']);
    await m.end();
    const r = (
      await admin.post('/v1/templates/preview').send({ emailSubject: 'x', emailBody: 'From {{operator.name}}', whatsappBody: 'x' }).expect(200)
    ).body;
    expect(r.emailHtml).toBe('<p>From **Sun** &amp; [Book](https://x.co) &lt;b&gt;</p>');
  });

  it('unknown placeholders are refused in the subject and WhatsApp text too', async () => {
    const base = { emailSubject: 'Hi', emailBody: 'Hi', whatsappBody: 'Hi', autoEmail: true, active: true };
    const sub = await admin.put('/v1/templates/booking_confirmation').send({ ...base, emailSubject: '{{guest.age}}' });
    expect(sub.status).toBe(400);
    expect(JSON.stringify(sub.body)).toContain('{{guest.age}}');
    await admin.put('/v1/templates/booking_confirmation').send({ ...base, whatsappBody: '{{guest.age}}' }).expect(400);
  });

  it('landlords and housekeepers cannot see templates', async () => {
    for (const role of ['landlord', 'housekeeper'] as const) {
      const a = (await signInAs(t, role, orgId)).agent;
      await a.get('/v1/templates').expect(403);
    }
  });

  it('frontdesk can read but not edit', async () => {
    const fd = (await signInAs(t, 'frontdesk', orgId)).agent;
    await fd.get('/v1/templates').expect(200);
    await fd
      .put('/v1/templates/booking_confirmation')
      .send({ emailSubject: 'x', emailBody: 'x', whatsappBody: 'x', autoEmail: true, active: true })
      .expect(403);
  });

  it("an edit in one org doesn't change another org's templates", async () => {
    const other = (await seedOrg('Other')).id;
    const otherAdmin = (await signInAs(t, 'admin', other)).agent;
    await admin
      .put('/v1/templates/booking_confirmation')
      .send({ emailSubject: 'Ours', emailBody: 'Ours', whatsappBody: 'Ours', autoEmail: true, active: true })
      .expect(200);
    const theirs = (await otherAdmin.get('/v1/templates').expect(200)).body.items[0];
    expect(theirs.emailSubject).not.toBe('Ours');
  });

  describe('VarsService.forBooking', () => {
    const vars = async (bookingId: string, opts?: { lastPaymentKobo?: number }) =>
      t.app.get(OrgDb).run(orgId, (tx) => t.app.get(VarsService).forBooking(tx, orgId, bookingId, opts));

    it('fills every placeholder from the booking, money, settings, unit and operator', async () => {
      const m = await migratorClient();
      await m.query(`update organization set "contactEmail"='hello@tanuhomes.ng', "contactPhone"='+2348030000000' where id=$1`, [orgId]);
      await m.query(`update org_settings set check_in_time='14:00', check_out_time='12:00' where org_id=$1`, [orgId]);
      await m.end();
      const unitId = await seedUnit(orgId, await seedProperty(orgId, { name: 'The Rock' }), { name: 'Kairo' });
      const m2 = await migratorClient();
      await m2.query(`update unit set check_in_instructions='Gate code 4321' where id=$1`, [unitId]);
      await m2.end();
      const guest = await seedGuest(orgId, { fullName: 'Adaeze  Okafor' });
      const b = await seedBooking(orgId, unitId, guest, { checkIn: '2026-11-01', checkOut: '2026-11-04', totalKobo: 60_000_000, depositKobo: 5_000_000 });
      await admin.post(`/v1/bookings/${b}/payments`).send({ kind: 'payment', amountKobo: 25_000_000, method: 'cash', receivedOn: '2026-10-14' }).expect(201);

      const v = await vars(b, { lastPaymentKobo: 25_000_000 });
      expect(v).toMatchObject({
        'guest.firstName': 'Adaeze',
        'guest.fullName': 'Adaeze  Okafor',
        'booking.checkIn': '1 Nov 2026',
        'booking.checkOut': '4 Nov 2026',
        'booking.nights': '3',
        'booking.guests': '2',
        'unit.name': 'Kairo',
        'property.name': 'The Rock',
        'property.address': 'Lekki Phase 1',
        'money.total': '₦600,000',
        'money.paid': '₦250,000',
        'money.balance': '₦350,000',
        'money.deposit': '₦50,000',
        'money.lastPayment': '₦250,000',
        'operator.name': 'Tanuhomes',
        'operator.email': 'hello@tanuhomes.ng',
        'operator.phone': '+2348030000000',
        'checkIn.time': '2:00 pm',
        'checkOut.time': '12:00 pm',
        'unit.checkInInstructions': 'Gate code 4321',
      });
      expect(v['booking.ref']).toMatch(/^T-/);
    });

    it('never shows a negative balance and leaves missing operator details blank', async () => {
      const unitId = await seedUnit(orgId, await seedProperty(orgId));
      const b = await seedBooking(orgId, unitId, await seedGuest(orgId), { checkIn: '2026-11-01', checkOut: '2026-11-02', totalKobo: 10_000_000 });
      await admin.post(`/v1/bookings/${b}/payments`).send({ kind: 'payment', amountKobo: 12_000_000, method: 'cash', receivedOn: '2026-10-14' }).expect(201);
      const v = await vars(b);
      expect(v).toMatchObject({ 'money.balance': '₦0', 'money.lastPayment': '₦0', 'operator.email': '', 'unit.checkInInstructions': '' });
      expect(v).toMatchObject({ 'booking.holdUntil': '', 'operator.website': '' });
    });

    it('shows the hold expiry in the operator timezone and the operator website (WB)', async () => {
      const unitId = await seedUnit(orgId, await seedProperty(orgId));
      const b = await seedBooking(orgId, unitId, await seedGuest(orgId), { checkIn: '2026-11-01', checkOut: '2026-11-02', totalKobo: 10_000_000 });
      const m = await migratorClient();
      // 15:30 UTC is 4:30 pm in Lagos (UTC+1).
      await m.query(`update booking set status='tentative', hold_until='2026-11-01T15:30:00Z' where id=$1`, [b]);
      await m.query(`update org_settings set public_site_url='https://tanuhomes.com' where org_id=$1`, [orgId]);
      await m.end();
      expect(await vars(b)).toMatchObject({ 'booking.holdUntil': '1 Nov 2026, 4:30 pm', 'operator.website': 'https://tanuhomes.com' });
    });
  });
});
