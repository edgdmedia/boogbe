import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { newId } from '../src/common/db/ids';

describe('money summary [PAY-07]', () => {
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
    orgId = (await seedOrg()).id;
    admin = (await signInAs(t, 'admin', orgId)).agent;
  });
  const insert = async (rows: [string, string, number, string, string][]) => {
    const m = await migratorClient();
    for (const [b, kind, amt, method, on] of rows)
      await m.query(
        `insert into payment(id, org_id, booking_id, kind, amount_kobo, method, received_on) values ($1,$2,$3,$4,$5,$6,$7)`,
        [newId(), orgId, b, kind, amt, method, on],
      );
    await m.end();
  };

  it('groups receipts by method and lists outstanding and deposits to return', async () => {
    const u = await seedUnit(orgId, await seedProperty(orgId));
    const g = await seedGuest(orgId, { fullName: 'Ada' });
    const b1 = await seedBooking(orgId, u, g, {
      checkIn: '2026-10-01',
      checkOut: '2026-10-03',
      status: 'checked_out',
      totalKobo: 40_000_000,
    });
    const b2 = await seedBooking(orgId, u, g, {
      checkIn: '2026-10-10',
      checkOut: '2026-10-12',
      status: 'confirmed',
      totalKobo: 40_000_000,
    });
    await insert([
      [b1, 'payment', 40_000_000, 'bank_transfer', '2026-10-01'],
      [b1, 'deposit_received', 10_000_000, 'cash', '2026-10-01'],
      [b2, 'payment', 15_000_000, 'pos', '2026-10-05'],
      [b2, 'payment', 5_000_000, 'pos', '2026-11-05'], // outside range
    ]);
    const r = (await admin.get('/v1/money/summary?from=2026-10-01&to=2026-11-01').expect(200)).body;
    expect(r.receivedByMethod).toEqual(
      expect.arrayContaining([
        { method: 'bank_transfer', kobo: 40_000_000 },
        { method: 'pos', kobo: 15_000_000 },
      ]),
    );
    expect(r.totalReceivedKobo).toBe(55_000_000);
    expect(r.depositsHeldKobo).toBe(10_000_000);
    expect(r.outstanding.map((o: { id: string; balanceKobo: number }) => [o.id, o.balanceKobo])).toEqual([
      [b2, 20_000_000],
    ]);
    expect(r.depositsToReturn).toEqual([
      expect.objectContaining({ bookingId: b1, heldKobo: 10_000_000, guestName: 'Ada' }),
    ]);
  });

  it('property filter applies to receipts, refunds, outstanding and deposits', async () => {
    const g = await seedGuest(orgId);
    const u1 = await seedUnit(orgId, await seedProperty(orgId));
    const p2 = await seedProperty(orgId);
    const u2 = await seedUnit(orgId, p2);
    const a = await seedBooking(orgId, u1, g, {
      checkIn: '2026-10-10',
      checkOut: '2026-10-12',
      status: 'confirmed',
      totalKobo: 30_000_000,
    });
    const b = await seedBooking(orgId, u2, g, {
      checkIn: '2026-10-14',
      checkOut: '2026-10-16',
      status: 'checked_out',
      totalKobo: 30_000_000,
    });
    await insert([
      [a, 'payment', 10_000_000, 'cash', '2026-10-05'],
      [b, 'payment', 20_000_000, 'pos', '2026-10-05'],
      [b, 'refund', 2_000_000, 'pos', '2026-10-06'],
      [b, 'deposit_received', 5_000_000, 'cash', '2026-10-05'],
    ]);
    const all = (await admin.get('/v1/money/summary?from=2026-10-01&to=2026-11-01').expect(200)).body;
    expect(all).toMatchObject({
      totalReceivedKobo: 30_000_000,
      refundsKobo: 2_000_000,
      depositsHeldKobo: 5_000_000,
    });
    expect(all.outstanding.map((o: { id: string }) => o.id)).toEqual([a, b]);
    const only2 = (
      await admin.get(`/v1/money/summary?from=2026-10-01&to=2026-11-01&propertyId=${p2}`).expect(200)
    ).body;
    expect(only2).toMatchObject({
      totalReceivedKobo: 20_000_000,
      refundsKobo: 2_000_000,
      depositsHeldKobo: 5_000_000,
    });
    expect(only2.outstanding.map((o: { id: string }) => o.id)).toEqual([b]);
    expect(only2.depositsToReturn.map((d: { bookingId: string }) => d.bookingId)).toEqual([b]);
  });

  it('frontdesk can read; housekeeper cannot; to must be after from', async () => {
    await (
      await signInAs(t, 'frontdesk', orgId)
    ).agent
      .get('/v1/money/summary?from=2026-10-01&to=2026-11-01')
      .expect(200);
    await (
      await signInAs(t, 'housekeeper', orgId)
    ).agent
      .get('/v1/money/summary?from=2026-10-01&to=2026-11-01')
      .expect(403);
    await admin.get('/v1/money/summary?from=2026-11-01&to=2026-10-01').expect(400);
  });
});
