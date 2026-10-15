import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, seedOrgSettings, signInAs } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { newId } from '../src/common/db/ids';
import { PublicOrgService } from '../src/modules/public/public-org.service';

// Lagos is UTC+1 with no DST, so "today" there is at most a day ahead of UTC: +2 days is always in the future.
const soon = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** An org with its settings row, online booking on, tanuhomes.com allowed, and the given units listed. */
async function publicOrg(listed: (orgId: string, propertyId: string) => Promise<string[]> = async () => []) {
  const org = await seedOrg();
  await seedOrgSettings(org.id, { public_enabled: true, public_origins: ['https://tanuhomes.com'] });
  const units = await listed(org.id, await seedProperty(org.id, { name: 'Destiny' }));
  if (units.length) {
    const m = await migratorClient();
    await m.query(`update unit set public_listed=true where id = any($1)`, [units]);
    await m.end();
  }
  return { ...org, units };
}

describe('public read API [WB]', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await truncateAll();
    t.app.get(PublicOrgService).clearCache();
  });

  it('is UNAVAILABLE until enabled, for unknown slugs and for unlisted units', async () => {
    const org = await seedOrg();
    await seedOrgSettings(org.id);
    const unitId = await seedUnit(org.id, await seedProperty(org.id));
    const off = await t.http.get(`/v1/public/${org.slug}/units`);
    expect(off.status).toBe(404);
    expect(off.body.error).toMatchObject({ code: 'UNAVAILABLE', message: 'Online booking is not available' });
    await seedOrgSettings(org.id, { public_enabled: true });
    t.app.get(PublicOrgService).clearCache();
    expect((await t.http.get(`/v1/public/${org.slug}/units`).expect(200)).body.units).toEqual([]);
    const unlisted = await t.http.get(`/v1/public/${org.slug}/units/${unitId}/availability?from=${soon(2)}&to=${soon(30)}`);
    expect(unlisted.status).toBe(404);
    expect(unlisted.body.error.code).toBe('UNAVAILABLE');
    expect((await t.http.get('/v1/public/no-such-org/units')).body.error.code).toBe('UNAVAILABLE');
  });

  it('a suspended operator is UNAVAILABLE, the same as an unknown one', async () => {
    const org = await publicOrg();
    const m = await migratorClient();
    await m.query(`update organization set status='suspended' where id=$1`, [org.id]);
    await m.end();
    const r = await t.http.get(`/v1/public/${org.slug}/units`);
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('UNAVAILABLE');
  });

  it('lists only active, listed units with their public fields', async () => {
    const org = await publicOrg(async (o, p) => [
      await seedUnit(o, p, { name: '1 bedroom', rateKobo: 17_500_000, maxGuests: 2 }),
      await seedUnit(o, p, { name: '2 bedrooms', rateKobo: 21_000_000, maxGuests: 4 }),
    ]);
    const hidden = await seedUnit(org.id, await seedProperty(org.id), { name: 'Not listed' });
    const r = (await t.http.get(`/v1/public/${org.slug.toUpperCase()}/units`).expect(200)).body.units;
    expect(r.map((u: { name: string }) => u.name).sort()).toEqual(['1 bedroom', '2 bedrooms']);
    expect(r[0]).toEqual({
      id: expect.any(String),
      propertyId: expect.any(String),
      propertyName: 'Destiny',
      name: expect.any(String),
      bedrooms: 2,
      maxGuests: expect.any(Number),
      nightlyRateKobo: expect.any(Number),
    });
    expect(JSON.stringify(r)).not.toContain(hidden);
  });

  it('availability lists blocked nights from every source, with no guest data', async () => {
    const org = await publicOrg(async (o, p) => [await seedUnit(o, p)]);
    const unitId = org.units[0]!;
    await seedBooking(org.id, unitId, await seedGuest(org.id, { fullName: 'Secret Name' }), { checkIn: soon(5), checkOut: soon(7) });
    await seedBooking(org.id, unitId, await seedGuest(org.id, { fullName: 'Held Guest', phoneE164: '+2348030000009' }), {
      checkIn: soon(9),
      checkOut: soon(10),
      status: 'tentative',
    });
    await seedBooking(org.id, unitId, await seedGuest(org.id, { fullName: 'Gone Guest', phoneE164: '+2348030000008' }), {
      checkIn: soon(12),
      checkOut: soon(13),
      status: 'cancelled',
    });
    const m = await migratorClient();
    const feed = newId();
    await m.query(
      `insert into ical_feed(id, org_id, unit_id, label, channel, url, updated_at) values ($1,$2,$3,'Airbnb','airbnb','https://a/x.ics',now())`,
      [feed, org.id, unitId],
    );
    await m.query(
      `insert into block(id, org_id, unit_id, start, "end", source, reason, feed_id, external_uid, external_summary, updated_at)
       values ($1,$2,$3,$4,$5,'ical','external',$6,'uid-1','Reserved: John Airbnb',now())`,
      [newId(), org.id, unitId, soon(15), soon(16), feed],
    );
    await m.end();
    const r = await t.http.get(`/v1/public/${org.slug}/units/${unitId}/availability?from=${soon(2)}&to=${soon(30)}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ unitId, from: soon(2), to: soon(30), checkInTime: '14:00', checkOutTime: '12:00' });
    expect(r.body.blockedNights).toEqual([soon(5), soon(6), soon(9), soon(15)]);
    expect(JSON.stringify(r.body)).not.toMatch(/Secret|Held|John|ref|guest|airbnb/i);
  });

  it('availability refuses past starts and windows over 90 days as INVALID_DATES', async () => {
    const org = await publicOrg(async (o, p) => [await seedUnit(o, p)]);
    const u = org.units[0]!;
    const past = await t.http.get(`/v1/public/${org.slug}/units/${u}/availability?from=2020-01-01&to=2020-01-10`);
    expect(past.status).toBe(422);
    expect(past.body.error.code).toBe('INVALID_DATES');
    const long = await t.http.get(`/v1/public/${org.slug}/units/${u}/availability?from=${soon(2)}&to=${soon(100)}`);
    expect(long.body.error.code).toBe('INVALID_DATES');
    const junk = await t.http.get(`/v1/public/${org.slug}/units/${u}/availability?from=soon&to=later`);
    expect(junk.body.error.code).toBe('INVALID_DATES');
  });

  it("another org's unit is UNAVAILABLE through this slug", async () => {
    const b = await publicOrg(async (o, p) => [await seedUnit(o, p)]);
    const a = await publicOrg(async (o, p) => [await seedUnit(o, p)]);
    const r = await t.http.get(`/v1/public/${a.slug}/units/${b.units[0]}/quote?checkIn=${soon(3)}&checkOut=${soon(5)}&guests=2`);
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('UNAVAILABLE');
    const av = await t.http.get(`/v1/public/${a.slug}/units/${b.units[0]}/availability?from=${soon(2)}&to=${soon(30)}`);
    expect(av.body.error.code).toBe('UNAVAILABLE');
  });

  it('quote equals back-office pricing and refuses taken dates, too many guests and bad dates', async () => {
    const org = await publicOrg(async (o, p) => [await seedUnit(o, p, { rateKobo: 15_000_000, maxGuests: 2 })]);
    const unitId = org.units[0]!;
    const m = await migratorClient();
    await m.query(
      `insert into unit_fee(id, org_id, unit_id, kind, label, amount_kobo, basis, updated_at) values ($1,$2,$3,'cleaning','Cleaning',1500000,'per_stay',now()),
       ($4,$2,$3,'caution_deposit','Caution deposit',5000000,'per_stay',now())`,
      [newId(), org.id, unitId, newId()],
    );
    await m.end();
    const ok = await t.http.get(`/v1/public/${org.slug}/units/${unitId}/quote?checkIn=${soon(3)}&checkOut=${soon(5)}&guests=2`).expect(200);
    // The same numbers the front desk sees for the same stay (one pricing function, no second implementation).
    const fd = (await signInAs(t, 'frontdesk', org.id)).agent;
    const back = (
      await fd.post('/v1/bookings/quote').send({ unitId, checkIn: soon(3), checkOut: soon(5), guestCount: 2 }).expect(200)
    ).body;
    expect(ok.body).toEqual({
      nights: back.nights,
      totalKobo: back.finalTotalKobo,
      depositKobo: back.depositKobo,
      lines: back.lines.map((l: { kind: string; label: string; amountKobo: number }) => ({ kind: l.kind, label: l.label, amountKobo: l.amountKobo })),
    });
    expect(ok.body).toMatchObject({ nights: 2, totalKobo: 30_000_000 + 1_500_000, depositKobo: 5_000_000 });

    const tooMany = await t.http.get(`/v1/public/${org.slug}/units/${unitId}/quote?checkIn=${soon(3)}&checkOut=${soon(5)}&guests=3`);
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.code).toBe('TOO_MANY_GUESTS');
    const past = await t.http.get(`/v1/public/${org.slug}/units/${unitId}/quote?checkIn=2020-01-01&checkOut=2020-01-03&guests=1`);
    expect(past.body.error.code).toBe('INVALID_DATES');
    const long = await t.http.get(`/v1/public/${org.slug}/units/${unitId}/quote?checkIn=${soon(3)}&checkOut=${soon(40)}&guests=1`);
    expect(long.body.error.code).toBe('INVALID_DATES');

    await seedBooking(org.id, unitId, await seedGuest(org.id), { checkIn: soon(4), checkOut: soon(6) });
    const taken = await t.http.get(`/v1/public/${org.slug}/units/${unitId}/quote?checkIn=${soon(3)}&checkOut=${soon(5)}&guests=2`);
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('DATES_UNAVAILABLE');
  });

  it('CORS reflects only listed origins, without credentials; preflight allows POST', async () => {
    const org = await publicOrg();
    const ok = await t.http.get(`/v1/public/${org.slug}/units`).set('Origin', 'https://tanuhomes.com');
    expect(ok.headers['access-control-allow-origin']).toBe('https://tanuhomes.com');
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();
    expect(ok.headers.vary).toMatch(/Origin/);
    const bad = await t.http.get(`/v1/public/${org.slug}/units`).set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    const app = await t.http.get(`/v1/public/${org.slug}/units`).set('Origin', process.env.APP_ORIGIN!);
    expect(app.headers['access-control-allow-origin']).toBeUndefined(); // the app origin gets no special pass here
    const pre = await t.http
      .options(`/v1/public/${org.slug}/requests`)
      .set('Origin', 'https://tanuhomes.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-methods']).toMatch(/POST/);
    expect(pre.headers['access-control-allow-headers']).toMatch(/content-type/i);
  });

  it('a disabled operator gets no CORS headers even for a once-allowed origin', async () => {
    const org = await seedOrg();
    await seedOrgSettings(org.id, { public_enabled: false, public_origins: ['https://tanuhomes.com'] });
    const r = await t.http.get(`/v1/public/${org.slug}/units`).set('Origin', 'https://tanuhomes.com');
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('the app keeps its own CORS (credentials) on non-public routes', async () => {
    const r = await t.http.get('/v1/health').set('Origin', process.env.APP_ORIGIN!);
    expect(r.headers['access-control-allow-origin']).toBe(process.env.APP_ORIGIN);
    expect(r.headers['access-control-allow-credentials']).toBe('true');
  });
});
