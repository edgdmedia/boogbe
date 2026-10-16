import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';

describe('calendar [CAL-01 CAL-02]', () => {
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

  it('returns properties, units and overlapping blocks only', async () => {
    const p = await seedProperty(orgId, { name: 'The Rock' });
    const u = await seedUnit(orgId, p, { name: 'Kairo' });
    await admin
      .post('/v1/blocks')
      .send({ unitId: u, start: '2026-10-30', end: '2026-11-02', reason: 'maintenance' })
      .expect(201);
    await admin
      .post('/v1/blocks')
      .send({ unitId: u, start: '2026-12-01', end: '2026-12-02', reason: 'maintenance' })
      .expect(201);
    const r = (await admin.get('/v1/calendar?from=2026-11-01&to=2026-11-15').expect(200)).body;
    expect(r.properties).toEqual([
      { id: p, name: 'The Rock', units: [expect.objectContaining({ id: u, name: 'Kairo' })] },
    ]);
    expect(r.items).toEqual([
      expect.objectContaining({
        kind: 'block',
        unitId: u,
        start: '2026-10-30',
        end: '2026-11-02',
        source: 'manual',
        label: 'Maintenance',
      }),
    ]);
    expect(r.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('booking items carry their source, so website requests can be marked [T-WB-07]', async () => {
    const p = await seedProperty(orgId);
    const u = await seedUnit(orgId, p);
    const g = await seedGuest(orgId);
    await seedBooking(orgId, u, g, { checkIn: '2026-11-03', checkOut: '2026-11-05', status: 'tentative', source: 'website' });
    const c = (await admin.get('/v1/calendar?from=2026-11-01&to=2026-11-10').expect(200)).body;
    expect(c.items.find((i: { kind: string }) => i.kind === 'booking')).toMatchObject({ source: 'website', status: 'tentative' });
  });

  it('rejects invalid ranges', async () => {
    await admin.get('/v1/calendar?from=2026-11-10&to=2026-11-01').expect(400);
    await admin.get('/v1/calendar?from=2026-11-01&to=2027-01-10').expect(400);
  });

  it('archived units are hidden', async () => {
    const p = await seedProperty(orgId);
    const u = await seedUnit(orgId, p);
    await admin.post(`/v1/units/${u}/archive`).expect(200);
    const r = (await admin.get('/v1/calendar?from=2026-11-01&to=2026-11-15').expect(200)).body;
    expect(r.properties).toEqual([]);
  });

  it('housekeeper cannot read the calendar', async () => {
    const hk = (await signInAs(t, 'housekeeper', orgId)).agent;
    await hk.get('/v1/calendar?from=2026-11-01&to=2026-11-15').expect(403);
  });
});
