import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { WorkerModule } from '../src/worker.module';
import { BookingHoldsJob } from '../src/modules/bookings/booking-holds.job';

describe('booking lifecycle [BKG-07 BKG-08 BKG-10 BKG-11]', () => {
  let t: TestApp;
  let fd: Agent;
  let orgId: string;
  let unitId: string;
  let unit2: string;
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
    const m = await migratorClient();
    await m.query(
      `insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, hold_hours, updated_at) values ($1,'T','T','T',24,now())`,
      [orgId],
    );
    await m.end();
    const p = await seedProperty(orgId);
    unitId = await seedUnit(orgId, p, { name: 'A', rateKobo: 10_000_000 });
    unit2 = await seedUnit(orgId, p, { name: 'B', rateKobo: 12_000_000 });
    guestId = await seedGuest(orgId);
    fd = (await signInAs(t, 'frontdesk', orgId)).agent;
  });
  const create = (o: Record<string, unknown> = {}) =>
    fd
      .post('/v1/bookings')
      .send({
        unitId,
        guestId,
        checkIn: '2026-11-01',
        checkOut: '2026-11-03',
        guestCount: 1,
        source: 'phone',
        ...o,
      })
      .expect(201)
      .then((r) => r.body);

  it('walks the happy path and refuses skipping steps', async () => {
    const b = await create();
    await fd.post(`/v1/bookings/${b.id}/transition`).send({ to: 'checked_in' }).expect(422);
    await fd.post(`/v1/bookings/${b.id}/transition`).send({ to: 'confirmed' }).expect(200);
    await fd.post(`/v1/bookings/${b.id}/transition`).send({ to: 'checked_in' }).expect(200);
    const done = (await fd.post(`/v1/bookings/${b.id}/transition`).send({ to: 'checked_out' }).expect(200))
      .body;
    expect(done.status).toBe('checked_out');
    expect(done.holdUntil).toBeNull();
    expect(done.history.map((h: { to: string }) => h.to)).toEqual([
      'tentative',
      'confirmed',
      'checked_in',
      'checked_out',
    ]);
  });

  it('changing the total on edit needs a reason [BKG-05]', async () => {
    const b = await create();
    const r = await fd.patch(`/v1/bookings/${b.id}`).send({ finalTotalKobo: 15_000_000 }).expect(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(r.body.error.details)).toContain('overrideReason');
    expect((await fd.get(`/v1/bookings/${b.id}`).expect(200)).body.finalTotalKobo).toBe(20_000_000);
    const ok = (
      await fd
        .patch(`/v1/bookings/${b.id}`)
        .send({ finalTotalKobo: 15_000_000, overrideReason: 'Repeat guest' })
        .expect(200)
    ).body;
    expect(ok).toMatchObject({ finalTotalKobo: 15_000_000, overrideReason: 'Repeat guest' });
  });

  it('extending a stay ignores itself; moving keeps price and flags stale', async () => {
    const b = await create();
    const ext = (await fd.patch(`/v1/bookings/${b.id}`).send({ checkOut: '2026-11-05' }).expect(200)).body;
    expect(ext).toMatchObject({
      checkOut: '2026-11-05',
      nights: 4,
      finalTotalKobo: 20_000_000,
      priceStale: true,
    });
    const rep = (await fd.patch(`/v1/bookings/${b.id}`).send({ reprice: true }).expect(200)).body;
    expect(rep).toMatchObject({ finalTotalKobo: 40_000_000, priceStale: false });
    const moved = (await fd.patch(`/v1/bookings/${b.id}`).send({ unitId: unit2, reprice: true }).expect(200))
      .body;
    expect(moved).toMatchObject({ unit: { id: unit2 }, finalTotalKobo: 48_000_000 });
  });

  it('moving onto an occupied unit is refused', async () => {
    await create({ unitId: unit2 });
    const b = await create();
    await fd.patch(`/v1/bookings/${b.id}`).send({ unitId: unit2 }).expect(409);
  });

  it('cancel frees dates and is final', async () => {
    const b = await create();
    await fd.post(`/v1/bookings/${b.id}/cancel`).send({ reason: 'Guest changed plans' }).expect(200);
    await create();
    await fd.post(`/v1/bookings/${b.id}/transition`).send({ to: 'confirmed' }).expect(422);
    await fd.patch(`/v1/bookings/${b.id}`).send({ notes: 'x' }).expect(422);
  });

  it('hold job cancels expired tentatives and notifies; skips bookings confirmed meanwhile', async () => {
    const expired = await create();
    const confirmed = await create({ checkIn: '2026-11-10', checkOut: '2026-11-11' });
    const m = await migratorClient();
    await m.query(`update booking set hold_until = now() - interval '1 minute' where id = any($1)`, [
      [expired.id, confirmed.id],
    ]);
    await m.end();
    await fd.post(`/v1/bookings/${confirmed.id}/transition`).send({ to: 'confirmed' }).expect(200);

    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const mod = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await mod.init();
    await mod.get(BookingHoldsJob).run();
    await mod.close();

    expect((await fd.get(`/v1/bookings/${expired.id}`).expect(200)).body.status).toBe('cancelled');
    expect((await fd.get(`/v1/bookings/${confirmed.id}`).expect(200)).body.status).toBe('confirmed');
    const n = (await fd.get('/v1/notifications').expect(200)).body;
    expect(n.unreadCount).toBe(1);
    expect(n.items[0]).toMatchObject({ kind: 'hold_expired', link: `/bookings/${expired.id}` });
  });
});
