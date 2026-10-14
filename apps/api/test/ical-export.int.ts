import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { newId } from '../src/common/db/ids';
import { ICAL_FETCHER } from '../src/modules/ical/tokens';

const EMPTY_CAL = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//y//EN\r\nEND:VCALENDAR\r\n';
const fakeFetcher = { fetch: async () => ({ status: 'ok', body: EMPTY_CAL, etag: null, lastModified: null }) };
const soon = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ymd = (s: string) => s.replace(/-/g, '');
const tokenOf = (url: string) => url.split('/').pop()!;

describe('iCal export [ICS-04]', () => {
  let t: TestApp;
  let admin: Agent;
  let orgId: string;
  let unitId: string;
  beforeAll(async () => {
    t = await createTestApp({ overrides: [[ICAL_FETCHER, fakeFetcher]] });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll();
    orgId = (await seedOrg()).id;
    unitId = await seedUnit(orgId, await seedProperty(orgId));
    admin = (await signInAs(t, 'admin', orgId)).agent;
  });

  const seedFeedsAndBlocks = async () => {
    const m = await migratorClient();
    const airbnbFeed = newId();
    const bdcFeed = newId();
    await m.query(
      `insert into ical_feed(id, org_id, unit_id, label, channel, url, updated_at) values ($1,$3,$4,'Airbnb','airbnb','https://a/x.ics',now()),($2,$3,$4,'BDC','booking_com','https://b/x.ics',now())`,
      [airbnbFeed, bdcFeed, orgId, unitId],
    );
    await m.query(
      `insert into block(id, org_id, unit_id, start, "end", source, reason, feed_id, external_uid, updated_at) values
      ($1,$3,$4,$5,$6,'ical','external',$7,'from-airbnb',now()), ($2,$3,$4,$8,$9,'ical','external',$10,'from-bdc',now())`,
      [newId(), newId(), orgId, unitId, soon(10), soon(12), airbnbFeed, soon(20), soon(22), bdcFeed],
    );
    await m.end();
    return { airbnbFeed, bdcFeed };
  };

  it("exports bookings and blocks without PII and excludes the channel's own events", async () => {
    const guest = await seedGuest(orgId, { fullName: 'Secret Name', phoneE164: '+2348030000001' });
    const bookingId = await seedBooking(orgId, unitId, guest, { checkIn: soon(5), checkOut: soon(7) });
    await seedBooking(orgId, unitId, guest, { checkIn: soon(30), checkOut: soon(31), status: 'cancelled' });
    const { airbnbFeed } = await seedFeedsAndBlocks();
    const ex = (await admin.post('/v1/ical/exports').send({ unitId, channel: 'airbnb' }).expect(201)).body;
    expect(ex).toMatchObject({ unitId, channel: 'airbnb', excludeFeedId: airbnbFeed, rotatedAt: null });
    expect(ex.url).toMatch(/^http:\/\/localhost:3060\/v1\/ical\/[A-Za-z0-9_-]{43}\.ics$/);

    const r = await t.http.get(`/v1/ical/${tokenOf(ex.url)}`).expect(200);
    expect(r.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(r.headers['cache-control']).toBe('private, max-age=300');
    const body = r.text;
    expect(body).toContain(`UID:booking-${bookingId}@boogbe`);
    expect(body).toContain(`DTSTART;VALUE=DATE:${ymd(soon(5))}`);
    expect(body).toContain('SUMMARY:Reserved');
    expect(body).toContain(`DTSTART;VALUE=DATE:${ymd(soon(20))}`); // Booking.com block included
    expect(body).toContain('SUMMARY:Blocked');
    expect(body).not.toContain(ymd(soon(10))); // Airbnb's own block excluded (echo loop)
    expect(body).not.toContain(ymd(soon(30))); // cancelled booking left out
    expect(body).not.toMatch(/Secret Name|2348030000001/);

    const all = (await admin.post('/v1/ical/exports').send({ unitId, channel: 'all' }).expect(201)).body;
    expect(all.excludeFeedId).toBeNull();
    expect((await t.http.get(`/v1/ical/${tokenOf(all.url)}`).expect(200)).text).toContain(ymd(soon(10)));
  });

  it("never echoes a channel's own blocks, even from a second or paused feed of that channel", async () => {
    const { airbnbFeed } = await seedFeedsAndBlocks();
    const m = await migratorClient();
    const second = newId();
    const other1 = newId();
    const other2 = newId();
    await m.query(
      `insert into ical_feed(id, org_id, unit_id, label, channel, url, active, updated_at) values
       ($1,$4,$5,'Airbnb 2','airbnb','https://a/y.ics',true,now()), ($2,$4,$5,'Site A','other','https://c/a.ics',true,now()), ($3,$4,$5,'Site B','other','https://c/b.ics',true,now())`,
      [second, other1, other2, orgId, unitId],
    );
    await m.query(
      `insert into block(id, org_id, unit_id, start, "end", source, reason, feed_id, external_uid, updated_at) values
       ($1,$4,$5,$6,$7,'ical','external',$8,'a2',now()), ($2,$4,$5,$9,$10,'ical','external',$11,'o1',now()), ($3,$4,$5,$12,$13,'ical','external',$14,'o2',now())`,
      [newId(), newId(), newId(), orgId, unitId, soon(40), soon(41), second, soon(50), soon(51), other1, soon(60), soon(61), other2],
    );
    await m.query(`update ical_feed set active = false where id = $1`, [airbnbFeed]);
    await m.end();
    const airbnb = (await admin.post('/v1/ical/exports').send({ unitId, channel: 'airbnb' }).expect(201)).body;
    const toAirbnb = (await t.http.get(`/v1/ical/${tokenOf(airbnb.url)}`).expect(200)).text;
    expect(toAirbnb).not.toContain(ymd(soon(10))); // paused Airbnb feed's block
    expect(toAirbnb).not.toContain(ymd(soon(40))); // second Airbnb feed's block
    expect(toAirbnb).toContain(ymd(soon(20))); // Booking.com
    // "other" is many unrelated sites: only the linked feed is left out, so no real busy dates are hidden.
    const other = (await admin.post('/v1/ical/exports').send({ unitId, channel: 'other' }).expect(201)).body;
    expect(other.excludeFeedId).toBe(other1);
    const toOther = (await t.http.get(`/v1/ical/${tokenOf(other.url)}`).expect(200)).text;
    expect(toOther).not.toContain(ymd(soon(50)));
    expect(toOther).toContain(ymd(soon(60)));
    expect(toOther).toContain(ymd(soon(10)));
  });

  it('leaves out stays that ended more than 30 days ago', async () => {
    const guest = await seedGuest(orgId);
    await seedBooking(orgId, unitId, guest, { checkIn: soon(-40), checkOut: soon(-35) });
    await seedBooking(orgId, unitId, guest, { checkIn: soon(-10), checkOut: soon(-8) });
    const ex = (await admin.post('/v1/ical/exports').send({ unitId, channel: 'all' }).expect(201)).body;
    const body = (await t.http.get(`/v1/ical/${tokenOf(ex.url)}`).expect(200)).text;
    expect(body).not.toContain(ymd(soon(-40)));
    expect(body).toContain(ymd(soon(-10)));
  });

  it('creating is idempotent per unit and channel, and the unit page lists exports', async () => {
    const a = (await admin.post('/v1/ical/exports').send({ unitId, channel: 'airbnb' }).expect(201)).body;
    const b = (await admin.post('/v1/ical/exports').send({ unitId, channel: 'airbnb' }).expect(201)).body;
    expect(b).toEqual(a);
    const page = (await admin.get(`/v1/units/${unitId}/ical`).expect(200)).body;
    expect(page.exports).toEqual([a]);
    await admin.post('/v1/ical/exports').send({ unitId: 'nope', channel: 'airbnb' }).expect(404);
  });

  it('re-links the exclusion when a same-channel feed is added, deactivated or removed later', async () => {
    const ex = (await admin.post('/v1/ical/exports').send({ unitId, channel: 'airbnb' }).expect(201)).body;
    expect(ex.excludeFeedId).toBeNull();
    const feed = (
      await admin
        .post('/v1/ical/feeds')
        .send({ unitId, label: 'Airbnb', channel: 'airbnb', url: 'https://www.airbnb.com/calendar/ical/1.ics' })
        .expect(201)
    ).body;
    const exportsNow = async () => (await admin.get(`/v1/units/${unitId}/ical`).expect(200)).body.exports;
    expect((await exportsNow())[0].excludeFeedId).toBe(feed.id);
    await admin.patch(`/v1/ical/feeds/${feed.id}`).send({ active: false }).expect(200);
    expect((await exportsNow())[0].excludeFeedId).toBeNull();
    await admin.patch(`/v1/ical/feeds/${feed.id}`).send({ active: true }).expect(200);
    expect((await exportsNow())[0].excludeFeedId).toBe(feed.id);
    await admin.delete(`/v1/ical/feeds/${feed.id}`).expect(200);
    expect((await exportsNow())[0].excludeFeedId).toBeNull();
  });

  it('rotating invalidates the old url; unknown tokens 404', async () => {
    const ex = (await admin.post('/v1/ical/exports').send({ unitId, channel: 'all' }).expect(201)).body;
    const rot = (await admin.post(`/v1/ical/exports/${ex.id}/rotate`).expect(200)).body;
    expect(rot.id).toBe(ex.id);
    expect(rot.url).not.toBe(ex.url);
    expect(rot.rotatedAt).not.toBeNull();
    await t.http.get(`/v1/ical/${tokenOf(ex.url)}`).expect(404);
    await t.http.get(`/v1/ical/${tokenOf(rot.url)}`).expect(200);
    await t.http.get('/v1/ical/nope.ics').expect(404);
    await t.http.get(`/v1/ical/${tokenOf(rot.url).replace('.ics', '')}`).expect(404);
  });

  it('only ical.write may create or rotate, and other orgs cannot touch the export', async () => {
    const ex = (await admin.post('/v1/ical/exports').send({ unitId, channel: 'all' }).expect(201)).body;
    const frontdesk = (await signInAs(t, 'frontdesk', orgId)).agent;
    await frontdesk.post('/v1/ical/exports').send({ unitId, channel: 'airbnb' }).expect(403);
    await frontdesk.post(`/v1/ical/exports/${ex.id}/rotate`).expect(403);
    const otherOrg = (await seedOrg()).id;
    const other = (await signInAs(t, 'admin', otherOrg)).agent;
    await other.post(`/v1/ical/exports/${ex.id}/rotate`).expect(404);
    await other.post('/v1/ical/exports').send({ unitId, channel: 'airbnb' }).expect(404);
  });

  it('a suspended organisation stops serving its calendars', async () => {
    const ex = (await admin.post('/v1/ical/exports').send({ unitId, channel: 'all' }).expect(201)).body;
    const m = await migratorClient();
    await m.query(`update organization set status = 'suspended' where id = $1`, [orgId]);
    await m.end();
    await t.http.get(`/v1/ical/${tokenOf(ex.url)}`).expect(404);
  });
});
