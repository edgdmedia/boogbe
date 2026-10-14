import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { ICAL_FETCHER } from '../src/modules/ical/tokens';
import { IcalSyncService } from '../src/modules/ical/sync.service';
import { newId } from '../src/common/db/ids';

const cal = (events: { uid: string; s: string; e: string }[]) =>
  `BEGIN:VCALENDAR\nVERSION:2.0\n${events
    .map((x) => `BEGIN:VEVENT\nUID:${x.uid}\nDTSTART;VALUE=DATE:${x.s.replace(/-/g, '')}\nDTEND;VALUE=DATE:${x.e.replace(/-/g, '')}\nSUMMARY:Reserved\nEND:VEVENT`)
    .join('\n')}\nEND:VCALENDAR`;
const OVERLAP = [{ uid: 'a1', s: '2026-11-03', e: '2026-11-05' }];

describe('channel conflicts [ICS-05 CAL-04]', () => {
  let t: TestApp;
  let admin: Agent;
  let orgId: string;
  let unitId: string;
  let feedId: string;
  let body = '';
  beforeAll(async () => {
    t = await createTestApp({
      overrides: [[ICAL_FETCHER, { fetch: async () => ({ status: 'ok', body, etag: null, lastModified: null }) }]],
    });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll();
    orgId = (await seedOrg()).id;
    unitId = await seedUnit(orgId, await seedProperty(orgId));
    admin = (await signInAs(t, 'admin', orgId)).agent;
    const m = await migratorClient();
    feedId = newId();
    await m.query(
      `insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'T','T','T',now())`,
      [orgId],
    );
    await m.query(
      `insert into ical_feed(id, org_id, unit_id, label, channel, url, updated_at) values ($1,$2,$3,'Airbnb','airbnb','https://www.airbnb.com/x.ics',now())`,
      [feedId, orgId, unitId],
    );
    await m.end();
  });
  const sync = () => t.app.get(IcalSyncService).syncFeed(orgId, feedId, new Date('2026-10-10T12:00:00Z'));
  const conflicts = async (status: 'open' | 'resolved') =>
    (await admin.get(`/v1/ical/conflicts?status=${status}`).expect(200)).body.items;
  const conflictNotes = async () =>
    (await admin.get('/v1/notifications').expect(200)).body.items.filter((n: { kind: string }) => n.kind === 'ical_conflict');
  const stay = async (status?: string) =>
    seedBooking(orgId, unitId, await seedGuest(orgId), { checkIn: '2026-11-01', checkOut: '2026-11-04', ...(status && { status }) });

  it('opens a conflict, flags the calendar, notifies once', async () => {
    const b = await stay();
    body = cal(OVERLAP);
    await sync();
    await sync();
    const list = await conflicts('open');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      status: 'open',
      resolution: null,
      booking: { id: b },
      block: { start: '2026-11-03', end: '2026-11-05', channel: 'airbnb' },
    });
    const c = (await admin.get('/v1/calendar?from=2026-11-01&to=2026-11-10').expect(200)).body;
    expect(c.items.find((i: { kind: string }) => i.kind === 'booking').hasConflict).toBe(true);
    expect(await conflictNotes()).toHaveLength(1);
  });

  it('a block that only touches the stay (checkout day) is not a conflict', async () => {
    await stay();
    body = cal([{ uid: 'a1', s: '2026-11-04', e: '2026-11-06' }]);
    await sync();
    expect(await conflicts('open')).toHaveLength(0);
  });

  it('conflict clears when block vanishes', async () => {
    await stay();
    body = cal(OVERLAP);
    await sync();
    body = cal([]);
    await sync();
    expect(await conflicts('open')).toHaveLength(0);
    expect((await conflicts('resolved'))[0]).toMatchObject({ resolution: 'cleared' });
    const c = (await admin.get('/v1/calendar?from=2026-11-01&to=2026-11-10').expect(200)).body;
    expect(c.items.find((i: { kind: string }) => i.kind === 'booking').hasConflict).toBe(false);
  });

  it('removing the feed clears its conflicts', async () => {
    await stay();
    body = cal(OVERLAP);
    await sync();
    await admin.delete(`/v1/ical/feeds/${feedId}`).expect(200);
    expect(await conflicts('open')).toHaveLength(0);
    expect((await conflicts('resolved'))[0]).toMatchObject({ resolution: 'cleared' });
  });

  it('resolve as external stays resolved on later syncs — no new conflict, no second alert', async () => {
    await stay();
    body = cal(OVERLAP);
    await sync();
    const c = (await conflicts('open'))[0];
    await admin.post(`/v1/ical/conflicts/${c.id}/resolve`).send({ action: 'external' }).expect(200);
    await sync();
    await sync();
    expect(await conflicts('open')).toHaveLength(0);
    expect(await conflicts('resolved')).toEqual([expect.objectContaining({ id: c.id, resolution: 'external' })]);
    expect(await conflictNotes()).toHaveLength(1);
  });

  it('a cleared pair that overlaps again opens a new conflict', async () => {
    await stay();
    body = cal(OVERLAP);
    await sync();
    body = cal([]);
    await sync();
    body = cal(OVERLAP);
    await sync();
    expect(await conflicts('open')).toHaveLength(1);
  });

  it('resolve as cancel_booking cancels with refund and records the resolution', async () => {
    const b = await stay();
    await admin
      .post(`/v1/bookings/${b}/payments`)
      .send({ kind: 'payment', amountKobo: 5_000_000, method: 'cash', receivedOn: '2026-10-10' })
      .expect(201);
    body = cal(OVERLAP);
    await sync();
    const c = (await conflicts('open'))[0];
    await admin
      .post(`/v1/ical/conflicts/${c.id}/resolve`)
      .send({ action: 'cancel_booking', refundKobo: 5_000_000, refundMethod: 'bank_transfer' })
      .expect(200);
    expect((await admin.get(`/v1/bookings/${b}`).expect(200)).body).toMatchObject({ status: 'cancelled', paidKobo: 0 });
    expect(await conflicts('resolved')).toEqual([expect.objectContaining({ id: c.id, resolution: 'cancelled_booking' })]);
  });

  it('a refund larger than paid rolls the whole resolution back', async () => {
    const b = await stay();
    body = cal(OVERLAP);
    await sync();
    const c = (await conflicts('open'))[0];
    await admin
      .post(`/v1/ical/conflicts/${c.id}/resolve`)
      .send({ action: 'cancel_booking', refundKobo: 1_000, refundMethod: 'cash' })
      .expect(422); // ledger refusal, as in payments.int.ts
    expect((await admin.get(`/v1/bookings/${b}`).expect(200)).body.status).toBe('confirmed');
    expect(await conflicts('open')).toHaveLength(1);
  });

  it('moved_booking requires the overlap to be gone', async () => {
    const b = await stay('confirmed');
    body = cal(OVERLAP);
    await sync();
    const c = (await conflicts('open'))[0];
    await admin.post(`/v1/ical/conflicts/${c.id}/resolve`).send({ action: 'moved_booking' }).expect(409);
    await admin.patch(`/v1/bookings/${b}`).send({ checkOut: '2026-11-03' }).expect(200); // shorten: overlap gone → auto-cleared by hook
    expect(await conflicts('open')).toHaveLength(0);
  });

  it('moving the booking to another unit clears the conflict', async () => {
    const b = await stay('confirmed');
    const other = await seedUnit(orgId, await seedProperty(orgId));
    body = cal(OVERLAP);
    await sync();
    await admin.patch(`/v1/bookings/${b}`).send({ unitId: other }).expect(200);
    expect(await conflicts('open')).toHaveLength(0);
  });

  it('a booking created over a channel block opens a conflict straight away', async () => {
    body = cal(OVERLAP);
    await sync();
    const guestId = await seedGuest(orgId);
    await admin
      .post('/v1/bookings')
      .send({ unitId, guestId, checkIn: '2026-11-01', checkOut: '2026-11-04', guestCount: 2, source: 'phone', acknowledgeIcalOverlap: true })
      .expect(201);
    expect(await conflicts('open')).toHaveLength(1);
  });

  it('resolving an unknown or already-resolved conflict is 404', async () => {
    await stay();
    body = cal(OVERLAP);
    await sync();
    const c = (await conflicts('open'))[0];
    await admin.post(`/v1/ical/conflicts/${c.id}/resolve`).send({ action: 'external' }).expect(200);
    await admin.post(`/v1/ical/conflicts/${c.id}/resolve`).send({ action: 'external' }).expect(404);
    await admin.post('/v1/ical/conflicts/nope/resolve').send({ action: 'external' }).expect(404);
  });
});
