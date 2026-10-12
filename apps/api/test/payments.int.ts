import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { ledger } from '@boogbe/shared';

describe('payments [PAY-01..05 BKG-09]', () => {
  let t: TestApp;
  let fd: Agent;
  let admin: Agent;
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
    orgId = (await seedOrg()).id;
    const m = await migratorClient();
    await m.query(
      `insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'TAN','TAN','TAN',now())`,
      [orgId],
    );
    await m.end();
    const unitId = await seedUnit(orgId, await seedProperty(orgId), { rateKobo: 20_000_000 });
    fd = (await signInAs(t, 'frontdesk', orgId)).agent;
    admin = (await signInAs(t, 'admin', orgId)).agent;
    await admin
      .post(`/v1/units/${unitId}/fees`)
      .send({ kind: 'caution_deposit', label: 'Caution deposit', amountKobo: 10_000_000, basis: 'per_stay' })
      .expect(201);
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
  });
  const pay = (body: Record<string, unknown>, agent = fd) =>
    agent
      .post(`/v1/bookings/${bookingId}/payments`)
      .send({ method: 'bank_transfer', receivedOn: '2026-10-10', ...body });

  it('part-payment updates balance, issues a receipt number and auto-confirms', async () => {
    const r = (await pay({ kind: 'payment', amountKobo: 30_000_000, reference: 'GTB-123' }).expect(201)).body;
    expect(r.totals).toMatchObject({ paidKobo: 30_000_000, balanceKobo: 30_000_000 });
    expect(r.entries[0].receiptNo).toBe('TAN-R-000001');
    const b = (await fd.get(`/v1/bookings/${bookingId}`).expect(200)).body;
    expect(b).toMatchObject({
      status: 'confirmed',
      paidKobo: 30_000_000,
      balanceKobo: 30_000_000,
      depositHeldKobo: 0,
    });
  });

  it('auto-confirm can be switched off', async () => {
    await admin.patch('/v1/org/settings').send({ autoConfirmOnPayment: false }).expect(200);
    await pay({ kind: 'payment', amountKobo: 1_000_000 }).expect(201);
    expect((await fd.get(`/v1/bookings/${bookingId}`).expect(200)).body.status).toBe('tentative');
  });

  it('deposit received, partly withheld with a note, rest returned', async () => {
    await pay({ kind: 'deposit_received', amountKobo: 10_000_000 }).expect(201);
    await pay({ kind: 'deposit_withheld', amountKobo: 2_000_000 }).expect(400); // note required
    await pay({ kind: 'deposit_withheld', amountKobo: 2_000_000, note: 'Broken glass' }).expect(201);
    await pay({ kind: 'deposit_returned', amountKobo: 9_000_000 }).expect(422);
    const r = (await pay({ kind: 'deposit_returned', amountKobo: 8_000_000 }).expect(201)).body;
    expect(r.totals.depositHeldKobo).toBe(0);
  });

  it('refund cannot exceed net paid', async () => {
    await pay({ kind: 'payment', amountKobo: 5_000_000 }).expect(201);
    expect((await pay({ kind: 'refund', amountKobo: 5_000_001 })).status).toBe(422);
  });

  it('overpayment gives negative balance', async () => {
    const r = (await pay({ kind: 'payment', amountKobo: 70_000_000 }).expect(201)).body;
    expect(r.totals.balanceKobo).toBe(-10_000_000);
  });

  it('void is admin-only, needs a reason, cannot repeat', async () => {
    const p = (await pay({ kind: 'payment', amountKobo: 5_000_000 }).expect(201)).body.entries[0];
    await fd
      .post(`/v1/bookings/${bookingId}/payments/void`)
      .send({ paymentId: p.id, reason: 'Wrong booking' })
      .expect(403);
    const r = (
      await admin
        .post(`/v1/bookings/${bookingId}/payments/void`)
        .send({ paymentId: p.id, reason: 'Wrong booking' })
        .expect(200)
    ).body;
    expect(r.totals.paidKobo).toBe(0);
    expect(r.entries.find((e: { id: string }) => e.id === p.id).voided).toBe(true);
    await admin
      .post(`/v1/bookings/${bookingId}/payments/void`)
      .send({ paymentId: p.id, reason: 'again' })
      .expect(422);
  });

  it('balanceDue filter and booking_money view agree with ledger()', async () => {
    await pay({ kind: 'payment', amountKobo: 20_000_000 }).expect(201);
    const list = (await fd.get('/v1/bookings?balanceDue=true').expect(200)).body.items;
    expect(list).toHaveLength(1);
    const lg = (await fd.get(`/v1/bookings/${bookingId}/ledger`).expect(200)).body;
    const b = (await fd.get(`/v1/bookings/${bookingId}`).expect(200)).body;
    const ts = ledger(
      lg.entries.map(
        (e: { id: string; kind: string; amountKobo: number; voidsPaymentId: string | null }) => e,
      ),
      { finalTotalKobo: b.finalTotalKobo, status: b.status },
    );
    expect(list[0].balanceKobo).toBe(ts.balanceKobo);
  });

  it('calendar items carry the balance', async () => {
    await pay({ kind: 'payment', amountKobo: 20_000_000 }).expect(201);
    const cal = (await fd.get('/v1/calendar?from=2026-11-01&to=2026-11-05').expect(200)).body;
    expect(cal.items[0].balanceKobo).toBe(40_000_000);
  });
});
