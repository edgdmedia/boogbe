import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { newId } from '../src/common/db/ids';

async function settings(orgId: string) {
  const m = await migratorClient();
  await m.query(
    `insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'TAN','TAN','TAN',now())`,
    [orgId],
  );
  await m.end();
}

describe('bookings [BKG-01..06 BKG-12 BKG-13]', () => {
  let t: TestApp;
  let fd: Agent;
  let orgId: string;
  let unitId: string;
  let guestId: string;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll();
    orgId = (await seedOrg()).id;
    await settings(orgId);
    unitId = await seedUnit(orgId, await seedProperty(orgId), {
      name: 'Kairo',
      rateKobo: 20_000_000,
      maxGuests: 4,
    });
    guestId = await seedGuest(orgId, { fullName: 'Adaeze Okafor' });
    fd = (await signInAs(t, 'frontdesk', orgId)).agent;
    await fd
      .post(`/v1/units/${unitId}/fees`)
      .send({ kind: 'caution_deposit', label: 'Caution deposit', amountKobo: 10_000_000, basis: 'per_stay' })
      .expect(403); // frontdesk can't add fees
    const admin = (await signInAs(t, 'admin', orgId)).agent;
    await admin
      .post(`/v1/units/${unitId}/fees`)
      .send({ kind: 'caution_deposit', label: 'Caution deposit', amountKobo: 10_000_000, basis: 'per_stay' })
      .expect(201);
    await admin
      .post(`/v1/units/${unitId}/fees`)
      .send({ kind: 'cleaning', label: 'Cleaning', amountKobo: 1_500_000, basis: 'per_stay' })
      .expect(201);
  });
  const body = (o: Record<string, unknown> = {}) => ({
    unitId,
    guestId,
    checkIn: '2026-11-01',
    checkOut: '2026-11-04',
    guestCount: 2,
    source: 'whatsapp',
    ...o,
  });

  it('quotes then creates a tentative booking with a ref and snapshot lines', async () => {
    const q = (
      await fd
        .post('/v1/bookings/quote')
        .send({ unitId, checkIn: '2026-11-01', checkOut: '2026-11-04', guestCount: 2 })
        .expect(200)
    ).body;
    expect(q).toMatchObject({
      nights: 3,
      computedTotalKobo: 61_500_000,
      depositKobo: 10_000_000,
      available: true,
      conflict: null,
      warnings: [],
    });
    const b = (await fd.post('/v1/bookings').send(body()).expect(201)).body;
    expect(b.ref).toMatch(/^TAN-\d{4}-0001$/);
    expect(b).toMatchObject({
      status: 'tentative',
      nights: 3,
      finalTotalKobo: 61_500_000,
      depositKobo: 10_000_000,
      guest: { fullName: 'Adaeze Okafor' },
    });
    expect(b.holdUntil).not.toBeNull();
    expect(b.history).toEqual([expect.objectContaining({ from: null, to: 'tentative' })]);
  });

  it('price snapshot survives a later rate change [BKG-06]', async () => {
    const b = (await fd.post('/v1/bookings').send(body()).expect(201)).body;
    const admin = (await signInAs(t, 'admin', orgId)).agent;
    await admin.patch(`/v1/units/${unitId}`).send({ nightlyRateKobo: 30_000_000 }).expect(200);
    expect((await fd.get(`/v1/bookings/${b.id}`).expect(200)).body.finalTotalKobo).toBe(61_500_000);
  });

  it('refuses overlapping dates with 409 and the conflicting booking', async () => {
    const a = (await fd.post('/v1/bookings').send(body()).expect(201)).body;
    const r = await fd.post('/v1/bookings').send(body({ checkIn: '2026-11-03', checkOut: '2026-11-05' }));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'DATES_UNAVAILABLE', details: { kind: 'booking', id: a.id } });
    await fd
      .post('/v1/bookings')
      .send(body({ checkIn: '2026-11-04', checkOut: '2026-11-05' }))
      .expect(201); // same-day turnover
  });

  it('refuses dates covered by a manual block', async () => {
    await fd
      .post('/v1/blocks')
      .send({ unitId, start: '2026-11-02', end: '2026-11-03', reason: 'maintenance' })
      .expect(201);
    const r = await fd.post('/v1/bookings').send(body());
    expect(r.status).toBe(409);
    expect(r.body.error.details.kind).toBe('block');
  });

  it('iCal overlap needs acknowledgement [BKG-03]', async () => {
    const m = await migratorClient();
    await m.query(
      `insert into ical_feed(id, org_id, unit_id, label, channel, url, updated_at) values ('f1',$1,$2,'Airbnb','airbnb','https://x.test/a.ics',now())`,
      [orgId, unitId],
    );
    await m.query(
      `insert into block(id, org_id, unit_id, start, "end", source, reason, external_summary, feed_id, external_uid, updated_at)
       values ($1,$2,$3,'2026-11-02','2026-11-03','ical','external','Airbnb (Not available)','f1','u1',now())`,
      [newId(), orgId, unitId],
    );
    await m.end();
    const r = await fd.post('/v1/bookings').send(body());
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ICAL_OVERLAP');
    const b = (
      await fd
        .post('/v1/bookings')
        .send(body({ acknowledgeIcalOverlap: true }))
        .expect(201)
    ).body;
    expect(b.icalWarningAck).toBe(true);
  });

  it('override needs a reason and records computed vs final [BKG-05]', async () => {
    await fd
      .post('/v1/bookings')
      .send(body({ finalTotalKobo: 55_000_000 }))
      .expect(400);
    const b = (
      await fd
        .post('/v1/bookings')
        .send(body({ finalTotalKobo: 55_000_000, overrideReason: 'Returning guest' }))
        .expect(201)
    ).body;
    expect(b).toMatchObject({
      computedTotalKobo: 61_500_000,
      finalTotalKobo: 55_000_000,
      overrideReason: 'Returning guest',
    });
    expect(b.lines.find((l: { kind: string }) => l.kind === 'adjustment').amountKobo).toBe(-6_500_000);
  });

  it('override cannot go negative', async () => {
    await fd
      .post('/v1/bookings')
      .send(body({ finalTotalKobo: -1, overrideReason: 'x x x' }))
      .expect(400);
  });

  it('capacity: frontdesk refused, admin with reason allowed [BKG-01]', async () => {
    const r = await fd.post('/v1/bookings').send(body({ guestCount: 6 }));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('CAPACITY_EXCEEDED');
    const admin = (await signInAs(t, 'admin', orgId)).agent;
    await admin
      .post('/v1/bookings')
      .send(body({ guestCount: 6, capacityOverrideReason: 'Two toddlers' }))
      .expect(201);
  });

  it('lists with filters and search; refs increment', async () => {
    await fd.post('/v1/bookings').send(body()).expect(201);
    await fd
      .post('/v1/bookings')
      .send(body({ checkIn: '2026-12-01', checkOut: '2026-12-02', status: 'confirmed', source: 'airbnb' }))
      .expect(201);
    const all = (await fd.get('/v1/bookings').expect(200)).body.items;
    expect(all.map((b: { ref: string }) => b.ref.slice(-4))).toEqual(['0002', '0001']);
    // List rows carry the hold so the front desk can show countdowns without a detail fetch per row (WB).
    const [confirmed, tentative] = all as { status: string; holdUntil: string | null }[];
    expect(confirmed!.holdUntil).toBeNull();
    expect(tentative!.status).toBe('tentative');
    expect(new Date(tentative!.holdUntil!).getTime()).toBeGreaterThan(Date.now());
    expect((await fd.get('/v1/bookings?status=confirmed').expect(200)).body.items).toHaveLength(1);
    expect((await fd.get('/v1/bookings?source=whatsapp').expect(200)).body.items).toHaveLength(1);
    expect((await fd.get('/v1/bookings?from=2026-11-30&to=2026-12-31').expect(200)).body.items).toHaveLength(
      1,
    );
    expect((await fd.get('/v1/bookings?q=adaeze').expect(200)).body.items).toHaveLength(2);
  });

  it('guest detail and guest bookings list show the stay [GST-04]', async () => {
    const b = (await fd.post('/v1/bookings').send(body()).expect(201)).body;
    expect(
      (await fd.get(`/v1/guests/${guestId}/bookings`).expect(200)).body.items.map(
        (x: { id: string }) => x.id,
      ),
    ).toEqual([b.id]);
    expect(
      (await fd.get(`/v1/guests/${guestId}`).expect(200)).body.bookings.map((x: { id: string }) => x.id),
    ).toEqual([b.id]);
  });

  it('bookings appear on the calendar with guest name', async () => {
    const b = (await fd.post('/v1/bookings').send(body()).expect(201)).body;
    const cal = (await fd.get('/v1/calendar?from=2026-11-01&to=2026-11-10').expect(200)).body;
    expect(cal.items).toEqual([
      expect.objectContaining({
        kind: 'booking',
        id: b.id,
        guestName: 'Adaeze Okafor',
        status: 'tentative',
        ref: b.ref,
      }),
    ]);
  });

  it('manual blocks are refused over a booking', async () => {
    await fd.post('/v1/bookings').send(body()).expect(201);
    await fd
      .post('/v1/blocks')
      .send({ unitId, start: '2026-11-02', end: '2026-11-03', reason: 'maintenance' })
      .expect(409);
  });
});
