import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedProperty, seedUnit } from './helpers/inventory';

describe('fees and blocks [INV-05 INV-07]', () => {
  let t: TestApp;
  let admin: Agent;
  let orgId: string;
  let unitId: string;
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
    unitId = await seedUnit(orgId, await seedProperty(orgId));
  });

  it('adds fees; caution deposit is refundable, others are not', async () => {
    const dep = (
      await admin
        .post(`/v1/units/${unitId}/fees`)
        .send({
          kind: 'caution_deposit',
          label: 'Caution deposit',
          amountKobo: 10_000_000,
          basis: 'per_stay',
        })
        .expect(201)
    ).body;
    const cln = (
      await admin
        .post(`/v1/units/${unitId}/fees`)
        .send({ kind: 'cleaning', label: 'Cleaning', amountKobo: 1_500_000, basis: 'per_stay' })
        .expect(201)
    ).body;
    expect(dep.refundable).toBe(true);
    expect(cln.refundable).toBe(false);
    await admin.post(`/v1/fees/${cln.id}/archive`).expect(200);
    expect(
      (await admin.get(`/v1/units/${unitId}/fees`).expect(200)).body.items.map(
        (f: { kind: string }) => f.kind,
      ),
    ).toEqual(['caution_deposit']);
  });

  it('allows adjacent manual blocks and refuses overlaps with 409', async () => {
    await admin
      .post('/v1/blocks')
      .send({ unitId, start: '2026-11-01', end: '2026-11-03', reason: 'maintenance' })
      .expect(201);
    await admin
      .post('/v1/blocks')
      .send({ unitId, start: '2026-11-03', end: '2026-11-04', reason: 'owner_stay' })
      .expect(201);
    const r = await admin
      .post('/v1/blocks')
      .send({ unitId, start: '2026-11-02', end: '2026-11-05', reason: 'other' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DATES_UNAVAILABLE');
  });

  it('frontdesk can block; housekeeper cannot', async () => {
    const fd = (await signInAs(t, 'frontdesk', orgId)).agent;
    await fd
      .post('/v1/blocks')
      .send({ unitId, start: '2026-11-01', end: '2026-11-02', reason: 'maintenance' })
      .expect(201);
    const hk = (await signInAs(t, 'housekeeper', orgId)).agent;
    await hk
      .post('/v1/blocks')
      .send({ unitId, start: '2026-11-05', end: '2026-11-06', reason: 'maintenance' })
      .expect(403);
  });

  it('deletes a manual block', async () => {
    const b = (
      await admin
        .post('/v1/blocks')
        .send({ unitId, start: '2026-11-01', end: '2026-11-02', reason: 'maintenance' })
        .expect(201)
    ).body;
    await admin.delete(`/v1/blocks/${b.id}`).expect(200);
  });
});
