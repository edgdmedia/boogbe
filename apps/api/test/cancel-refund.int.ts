import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedGuest, seedProperty, seedUnit } from './helpers/inventory';

describe('cancel with refund [BKG-11] and receipts [PAY-06]', () => {
  let t: TestApp;
  let fd: Agent;
  let orgId: string;
  let bookingId: string;
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
      `insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'TAN','TAN','TAN',now())`,
      [orgId],
    );
    await m.end();
    const unitId = await seedUnit(orgId, await seedProperty(orgId), { rateKobo: 20_000_000 });
    fd = (await signInAs(t, 'frontdesk', orgId)).agent;
    bookingId = (
      await fd
        .post('/v1/bookings')
        .send({
          unitId,
          guestId: await seedGuest(orgId),
          checkIn: '2026-11-01',
          checkOut: '2026-11-04',
          guestCount: 2,
          source: 'whatsapp',
        })
        .expect(201)
    ).body.id;
    await fd
      .post(`/v1/bookings/${bookingId}/payments`)
      .send({ kind: 'payment', amountKobo: 30_000_000, method: 'bank_transfer', receivedOn: '2026-10-10' })
      .expect(201);
  });

  it('cancels and records the refund atomically; retained shows the rest', async () => {
    await fd
      .post(`/v1/bookings/${bookingId}/cancel`)
      .send({ reason: 'Flight cancelled', refundKobo: 20_000_000, refundMethod: 'bank_transfer' })
      .expect(200);
    const lg = (await fd.get(`/v1/bookings/${bookingId}/ledger`).expect(200)).body;
    expect(lg.totals).toMatchObject({ refundedKobo: 20_000_000, retainedKobo: 10_000_000, balanceKobo: 0 });
  });

  it('a refund over the paid amount rolls the cancel back', async () => {
    await fd
      .post(`/v1/bookings/${bookingId}/cancel`)
      .send({ reason: 'x x x', refundKobo: 40_000_000, refundMethod: 'cash' })
      .expect(422);
    expect((await fd.get(`/v1/bookings/${bookingId}`).expect(200)).body.status).toBe('confirmed');
  });

  it('cancel without a refund still works', async () => {
    const b = (
      await fd.post(`/v1/bookings/${bookingId}/cancel`).send({ reason: 'Guest changed plans' }).expect(200)
    ).body;
    expect(b).toMatchObject({ status: 'cancelled', balanceKobo: 0 });
  });

  it('downloads a receipt PDF', async () => {
    const lg = (await fd.get(`/v1/bookings/${bookingId}/ledger`).expect(200)).body;
    const r = await fd
      .get(`/v1/payments/${lg.entries[0].id}/receipt.pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toContain('TAN-R-000001.pdf');
    expect((r.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });
});
