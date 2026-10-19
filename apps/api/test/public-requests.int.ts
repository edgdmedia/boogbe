import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, seedOrgSettings, signInAs } from './helpers/users';
import { seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { TURNSTILE_VERIFIER } from '../src/modules/public/turnstile';
import { PublicOrgService } from '../src/modules/public/public-org.service';
import { Test } from '@nestjs/testing';
import { BookingHoldsJob } from '../src/modules/bookings/booking-holds.job';
import { WorkerModule } from '../src/worker.module';

const soon = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
let pass = true;
let hostname = 'tanuhomes.com';
const seen: { token: string; ip: string | undefined }[] = [];
const fakeTurnstile = {
  verify: async (token: string, ip: string | undefined) => {
    seen.push({ token, ip });
    return { success: pass, hostname };
  },
};
// Every request gets its own client IP unless a test pins one: the request throttle (5 / 10 min) is per IP and
// would otherwise trip across the whole file.
let ipSeq = 0;
const nextIp = () => `198.51.100.${(ipSeq++ % 250) + 1}`;

async function rows(sql: string, params: unknown[] = []) {
  const m = await migratorClient();
  try {
    return (await m.query(sql, params)).rows;
  } finally {
    await m.end();
  }
}

describe('public booking requests [WB]', () => {
  let t: TestApp;
  let slug: string;
  let orgId: string;
  let unitId: string;
  beforeAll(async () => {
    t = await createTestApp({ overrides: [[TURNSTILE_VERIFIER, fakeTurnstile]] });
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await truncateAll();
    t.app.get(PublicOrgService).clearCache();
    pass = true;
    hostname = 'tanuhomes.com';
    seen.length = 0;
    const org = await seedOrg('Tanuhomes');
    orgId = org.id;
    slug = org.slug;
    await seedOrgSettings(orgId, {
      public_enabled: true,
      public_hold_minutes: 120,
      public_origins: ['https://tanuhomes.com'],
      notify_emails: ['team@op.ng'],
    });
    unitId = await seedUnit(orgId, await seedProperty(orgId, { name: 'Destiny' }), { name: '1 bedroom', maxGuests: 2 });
    await rows(`update organization set "contactEmail"='hello@op.ng' where id=$1`, [orgId]);
    await rows(`update unit set public_listed=true where id=$1`, [unitId]);
  });
  const body = (o: Record<string, unknown> = {}) => ({
    unitId,
    checkIn: soon(5),
    checkOut: soon(7),
    guests: 2,
    fullName: 'Ada Obi',
    phone: '08030000000',
    email: 'ada@example.ng',
    turnstileToken: 'tok',
    ...o,
  });
  const post = (o: Record<string, unknown> = {}, ip = nextIp()) =>
    t.http.post(`/v1/public/${slug}/requests`).set('X-Forwarded-For', ip).send(body(o));

  it('creates a tentative website booking held for public_hold_minutes, notifies the team and queues emails', async () => {
    const admin = await signInAs(t, 'admin', orgId);
    const r = await post({ note: 'Arriving **late** [x](https://evil.example)' }, '203.0.113.7');
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ ref: expect.stringMatching(/-\d{4}-\d{4}$/), holdUntil: expect.any(String), totalKobo: expect.any(Number) });
    expect(seen).toEqual([{ token: 'tok', ip: '203.0.113.7' }]);

    const [b] = await rows('select id, status, source, hold_until, created_by_member_id, notes from booking where ref=$1', [r.body.ref]);
    expect(b).toMatchObject({ status: 'tentative', source: 'website', created_by_member_id: null });
    expect(b.notes).toBe('Website request (email given: ada@example.ng): Arriving **late** [x](https://evil.example)');
    // From the API's ISO timestamp: the column is a naive timestamp, which pg would read in this machine's timezone.
    const hold = new Date(r.body.holdUntil).getTime() - Date.now();
    expect(hold).toBeGreaterThan(119 * 60_000);
    expect(hold).toBeLessThanOrEqual(120 * 60_000);

    const mail = await rows('select recipient, template_key, subject, body_html, body_text from outbound_message where org_id=$1 order by recipient', [orgId]);
    expect(mail.map((x) => [x.recipient, x.template_key])).toEqual([
      ['ada@example.ng', 'website_request_received'],
      ['hello@op.ng', null],
      ['team@op.ng', null],
    ]);
    const team = mail.find((x) => x.recipient === 'team@op.ng')!;
    expect(team.subject).toMatch(/^New booking request: Destiny · 1 bedroom, /);
    // Deep link to the booking (rendered as a link for the https app origin in production; the test origin is http).
    expect(team.body_text).toContain(`${process.env.APP_ORIGIN}/bookings/${b.id}`);
    expect(team.body_html).toContain('href="https://wa.me/2348030000000');
    expect(team.body_html).not.toContain('evil.example"'); // guest text never becomes a link
    const guest = mail.find((x) => x.recipient === 'ada@example.ng')!;
    expect(guest.subject).toBe(`We received your request – ${r.body.ref}`); // placeholders filled in the subject too
    expect(guest.body_html).toMatch(/holding these dates for you until \d{1,2} \w{3,4} \d{4}, \d{1,2}:\d{2} (am|pm)/);

    const items = (await admin.agent.get('/v1/notifications').expect(200)).body.items as { kind: string; link: string }[];
    expect(items).toEqual([expect.objectContaining({ kind: 'website_request', link: `/bookings/${b.id}` })]);

    const [audit] = await rows(`select actor_user_id, actor_member_id, ip from audit_log where entity_id=$1 and action='booking.create'`, [b.id]);
    expect(audit).toMatchObject({ actor_user_id: 'public', actor_member_id: null });
    expect(audit.ip).toMatch(/^[0-9a-f]{16,}$/); // a hash, never the raw address
    expect(audit.ip).not.toContain('203.0.113.7');
  });

  it('no email given: no guest email, team still told', async () => {
    expect((await post({ email: '' })).status).toBe(201);
    const mail = await rows('select recipient from outbound_message where org_id=$1 order by recipient', [orgId]);
    expect(mail.map((x) => x.recipient)).toEqual(['hello@op.ng', 'team@op.ng']);
  });

  it('reuses the guest by phone without changing their recorded contact details, and refuses overlapping nights', async () => {
    // A public form must not redirect a known guest's future emails (receipts, check-in codes) to whoever typed their phone.
    await seedGuest(orgId, { fullName: 'Ada (front desk)', phoneE164: '+2348030000000' });
    const r = await post({ email: 'someone_else@example.ng' });
    expect(r.status).toBe(201);
    const again = await post({ checkIn: soon(6), checkOut: soon(8) });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('DATES_UNAVAILABLE');
    const guests = await rows('select full_name, email from guest where org_id=$1', [orgId]);
    expect(guests).toEqual([{ full_name: 'Ada (front desk)', email: null }]);
    // The request's own "received" email still goes to the address typed in the form, and the team sees it unaltered.
    const mail = await rows(`select recipient, template_key, body_text from outbound_message where org_id=$1 order by recipient`, [orgId]);
    const received = mail.find((x) => x.template_key === 'website_request_received')!;
    expect(received.recipient).toBe('someone_else@example.ng');
    // Greets the name typed in the form, never the recorded guest's (phone in, name out would leak who stays here).
    expect(received.body_text).toMatch(/^Hi Ada,/);
    expect(received.body_text).not.toContain('front desk');
    expect(mail.find((x) => x.recipient === 'team@op.ng')?.body_text).toContain('Email: someone_else@example.ng');
    const [b] = await rows('select notes from booking where ref=$1', [r.body.ref]);
    expect(b.notes).toContain('someone_else@example.ng');
  });

  it('a known guest with a different saved email: "received" goes to the typed address, the saved one is kept', async () => {
    await seedGuest(orgId, { fullName: 'Ada (front desk)', phoneE164: '+2348030000000' });
    await rows(`update guest set email='ada.saved@example.ng' where org_id=$1 returning id`, [orgId]);
    const r = await post({ email: 'typed@example.ng' });
    expect(r.status).toBe(201);
    expect(await rows('select email from guest where org_id=$1', [orgId])).toEqual([{ email: 'ada.saved@example.ng' }]);
    const mail = await rows(`select recipient from outbound_message where org_id=$1 and template_key='website_request_received'`, [orgId]);
    expect(mail).toEqual([{ recipient: 'typed@example.ng' }]);
  });

  it('two simultaneous requests for the same nights: exactly one wins', async () => {
    const [a, b] = await Promise.all([post(), post({ phone: '08031111111' })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await rows(`select count(*)::int c from booking where org_id=$1`, [orgId]))[0].c).toBe(1);
  });

  it('refuses failed Turnstile, too many guests, unlisted units and a disabled operator', async () => {
    pass = false;
    const v = await post();
    expect(v.status).toBe(400);
    expect(v.body.error.code).toBe('VERIFICATION_FAILED');
    pass = true;
    hostname = 'evil.example'; // a valid token solved on someone else's site
    expect((await post()).body.error.code).toBe('VERIFICATION_FAILED');
    hostname = 'www.tanuhomes.com'; // not one of this operator's listed origins
    expect((await post()).body.error.code).toBe('VERIFICATION_FAILED');
    hostname = 'tanuhomes.com';
    expect((await post({ guests: 3 })).body.error.code).toBe('TOO_MANY_GUESTS');
    const other = await seedUnit(orgId, await seedProperty(orgId));
    expect((await post({ unitId: other })).body.error.code).toBe('UNAVAILABLE');
    await rows(`update org_settings set public_enabled=false where org_id=$1`, [orgId]);
    t.app.get(PublicOrgService).clearCache();
    expect((await post()).body.error.code).toBe('UNAVAILABLE');
    expect((await rows(`select count(*)::int c from booking`))[0].c).toBe(0);
  });

  it('validates the form: bad phone, past dates, long notes', async () => {
    expect((await post({ phone: '12' })).body.error.code).toBe('VALIDATION_FAILED');
    expect((await post({ note: 'x'.repeat(1001) })).body.error.code).toBe('VALIDATION_FAILED');
    expect((await post({ checkIn: '2020-01-01', checkOut: '2020-01-03' })).body.error.code).toBe('INVALID_DATES');
  });

  it('confirmation emails the website guest; a declined or expired hold sends the closed email, once', async () => {
    const r1 = await post();
    const r2 = await post({ checkIn: soon(10), checkOut: soon(12), phone: '08032222222', email: 'bo@example.ng' });
    const r3 = await post({ checkIn: soon(15), checkOut: soon(16), phone: '08033333333', email: 'cy@example.ng' });
    await rows(`update booking set hold_until=now() - interval '1 minute' where ref=$1`, [r1.body.ref]);
    // The holds job runs in the worker process, as in production.
    const prevDb = process.env.DATABASE_URL;
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    try {
      await worker.get(BookingHoldsJob).run();
      await worker.get(BookingHoldsJob).run(); // a second run must not send the closed email again
    } finally {
      await worker.close();
      process.env.DATABASE_URL = prevDb;
    }
    const { agent } = await signInAs(t, 'frontdesk', orgId);
    const [{ id: id2 }] = await rows('select id from booking where ref=$1', [r2.body.ref]);
    const [{ id: id3 }] = await rows('select id from booking where ref=$1', [r3.body.ref]);
    expect((await agent.post(`/v1/bookings/${id2}/transition`).send({ to: 'confirmed' })).status).toBe(200);
    expect((await agent.post(`/v1/bookings/${id3}/cancel`).send({ reason: 'Dates not available' })).status).toBeLessThan(300);
    const keys = await rows(
      `select recipient, template_key from outbound_message where template_key in ('website_request_closed','booking_confirmation') order by recipient`,
    );
    expect(keys).toEqual([
      { recipient: 'ada@example.ng', template_key: 'website_request_closed' },
      { recipient: 'bo@example.ng', template_key: 'booking_confirmation' },
      { recipient: 'cy@example.ng', template_key: 'website_request_closed' },
    ]);
  });

  it('staff bookings never get website emails', async () => {
    const { agent } = await signInAs(t, 'frontdesk', orgId);
    const guestId = await seedGuest(orgId, { fullName: 'Walk In', phoneE164: '+2348035555555' });
    await rows(`update guest set email='walk@example.ng' where id=$1`, [guestId]);
    const id = (
      await agent.post('/v1/bookings').send({ unitId, guestId, checkIn: soon(20), checkOut: soon(21), guestCount: 1, source: 'phone' }).expect(201)
    ).body.id;
    await agent.post(`/v1/bookings/${id}/transition`).send({ to: 'confirmed' }).expect(200);
    expect(await rows(`select 1 from outbound_message where recipient='walk@example.ng'`)).toEqual([]);
  });

  it('CORS on the request route reflects only the operator website', async () => {
    const ok = await t.http.post(`/v1/public/${slug}/requests`).set('Origin', 'https://tanuhomes.com').set('X-Forwarded-For', nextIp()).send(body());
    expect(ok.status).toBe(201);
    expect(ok.headers['access-control-allow-origin']).toBe('https://tanuhomes.com');
    const bad = await t.http.post(`/v1/public/${slug}/requests`).set('Origin', 'https://evil.example').set('X-Forwarded-For', nextIp()).send(body({ checkIn: soon(30), checkOut: soon(31) }));
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('throttles to 5 requests per 10 minutes per IP', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++)
      codes.push((await post({ checkIn: soon(40 + i * 3), checkOut: soon(41 + i * 3), phone: `0803444444${i}` }, '203.0.113.9')).status);
    expect(codes.slice(0, 5).every((c) => c === 201)).toBe(true);
    expect(codes[5]).toBe(429);
  });
});
