import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { addDays, todayIn } from '@boogbe/shared';
import { seedOwner } from './helpers/inventory';

// New units start their first ownership period today (Lagos), so ownership changes must be dated after it.
const D = (n: number) => addDays(todayIn('Africa/Lagos'), n);

describe('inventory [INV-01..06]', () => {
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
    orgId = (await seedOrg('Tanuhomes')).id;
    admin = (await signInAs(t, 'admin', orgId)).agent;
  });

  const prop = (o: Record<string, unknown> = {}) => ({
    name: 'The Rock',
    address: '3 Olu-Babajide Close, Lekki Phase 1',
    feeType: 'pct_gross',
    feeBps: 2000,
    feeFixedMonthlyKobo: 0,
    ...o,
  });
  const unit = (propertyId: string, o: Record<string, unknown> = {}) => ({
    propertyId,
    name: 'Kairo',
    bedrooms: 2,
    maxGuests: 4,
    nightlyRateKobo: 20_000_000,
    defaultAssigneeMemberId: null,
    feeOverride: false,
    feeType: 'none',
    feeBps: 0,
    feeFixedMonthlyKobo: 0,
    ...o,
  });

  it('creates property and unit; unit owner defaults to operator', async () => {
    const p = (await admin.post('/v1/properties').send(prop()).expect(201)).body;
    const u = (await admin.post('/v1/units').send(unit(p.id)).expect(201)).body;
    expect(u).toMatchObject({
      name: 'Kairo',
      nightlyRateKobo: 20_000_000,
      ownerFollowsProperty: true,
      currentOwner: null,
      currentOwnerSource: 'operator',
    });
    const list = (await admin.get(`/v1/units?propertyId=${p.id}`).expect(200)).body.items;
    expect(list).toHaveLength(1);
  });

  it('unit name must be unique within a property', async () => {
    const p = (await admin.post('/v1/properties').send(prop()).expect(201)).body;
    await admin.post('/v1/units').send(unit(p.id)).expect(201);
    await admin.post('/v1/units').send(unit(p.id)).expect(409);
  });

  it('property default owner applies to following units from the effective date', async () => {
    const owner = await seedOwner(orgId, { name: 'Mrs Adebayo' });
    const p = (await admin.post('/v1/properties').send(prop()).expect(201)).body;
    const u = (await admin.post('/v1/units').send(unit(p.id)).expect(201)).body;
    await admin
      .post(`/v1/properties/${p.id}/owner`)
      .send({ defaultOwnerId: owner, effectiveFrom: D(1) })
      .expect(200);
    const hist = (await admin.get(`/v1/units/${u.id}/ownership`).expect(200)).body.items;
    expect(hist).toEqual([
      expect.objectContaining({ ownerId: null, to: D(1) }),
      expect.objectContaining({ ownerId: owner, ownerName: 'Mrs Adebayo', from: D(1), to: null }),
    ]);
  });

  it('property default change skips overridden units', async () => {
    const o1 = await seedOwner(orgId, { name: 'O1' });
    const o2 = await seedOwner(orgId, { name: 'O2' });
    const p = (await admin.post('/v1/properties').send(prop()).expect(201)).body;
    const a = (
      await admin
        .post('/v1/units')
        .send(unit(p.id, { name: 'A' }))
        .expect(201)
    ).body;
    const b = (
      await admin
        .post('/v1/units')
        .send(unit(p.id, { name: 'B' }))
        .expect(201)
    ).body;
    await admin
      .post(`/v1/units/${b.id}/owner`)
      .send({ mode: 'owner', ownerId: o2, effectiveFrom: D(1) })
      .expect(200);
    await admin
      .post(`/v1/properties/${p.id}/owner`)
      .send({ defaultOwnerId: o1, effectiveFrom: D(2) })
      .expect(200);
    const units = (await admin.get(`/v1/units?propertyId=${p.id}`).expect(200)).body.items as {
      id: string;
      currentOwner: { id: string } | null;
      currentOwnerSource: string;
    }[];
    // currentOwner is "as of today in Lagos"; the test pins today via ?asOf
    const asOf = (await admin.get(`/v1/units?propertyId=${p.id}&asOf=${D(3)}`).expect(200)).body
      .items as typeof units;
    expect(asOf.find((x) => x.id === a.id)).toMatchObject({
      currentOwner: { id: o1 },
      currentOwnerSource: 'property',
    });
    expect(asOf.find((x) => x.id === b.id)).toMatchObject({
      currentOwner: { id: o2 },
      currentOwnerSource: 'unit',
    });
    expect(units).toHaveLength(2);
  });

  it('same-day ownership change replaces the period', async () => {
    const o1 = await seedOwner(orgId);
    const o2 = await seedOwner(orgId);
    const p = (await admin.post('/v1/properties').send(prop()).expect(201)).body;
    const u = (await admin.post('/v1/units').send(unit(p.id)).expect(201)).body;
    await admin
      .post(`/v1/units/${u.id}/owner`)
      .send({ mode: 'owner', ownerId: o1, effectiveFrom: D(1) })
      .expect(200);
    await admin
      .post(`/v1/units/${u.id}/owner`)
      .send({ mode: 'owner', ownerId: o2, effectiveFrom: D(1) })
      .expect(200);
    const hist = (await admin.get(`/v1/units/${u.id}/ownership`).expect(200)).body.items;
    expect(hist.at(-1)).toMatchObject({ ownerId: o2, from: D(1), to: null });
    expect(hist.filter((h: { from: string }) => h.from === D(1))).toHaveLength(1);
  });

  it('refuses backdated ownership changes', async () => {
    const o1 = await seedOwner(orgId);
    const p = (await admin.post('/v1/properties').send(prop()).expect(201)).body;
    const u = (await admin.post('/v1/units').send(unit(p.id)).expect(201)).body;
    await admin
      .post(`/v1/units/${u.id}/owner`)
      .send({ mode: 'owner', ownerId: o1, effectiveFrom: D(5) })
      .expect(200);
    const r = await admin.post(`/v1/units/${u.id}/owner`).send({ mode: 'operator', effectiveFrom: D(1) });
    expect(r.status).toBe(422);
  });

  it('owners CRUD validates NUBAN and archive hides them', async () => {
    await admin.post('/v1/owners').send({ name: 'Mrs A', accountNumber: '123' }).expect(400);
    const o = (
      await admin
        .post('/v1/owners')
        .send({ name: 'Mrs A', accountNumber: '0123456789', bankName: 'GTBank' })
        .expect(201)
    ).body;
    expect(o).toMatchObject({ name: 'Mrs A', portalStatus: 'none', active: true });
    await admin.post(`/v1/owners/${o.id}/archive`).expect(200);
    expect((await admin.get('/v1/owners').expect(200)).body.items).toEqual([]);
  });

  it('inviting an owner creates a landlord invitation and links on accept', async () => {
    const o = (await admin.post('/v1/owners').send({ name: 'Mrs A', email: 'mrsa@example.ng' }).expect(201))
      .body;
    const inv = await admin.post(`/v1/owners/${o.id}/invite`).expect(200);
    expect(inv.body.portalStatus).toBe('invited');
    const agent = t.agent();
    await agent
      .post('/v1/auth/sign-up/email')
      .send({
        email: 'mrsa@example.ng',
        password: 'correct-horse-battery',
        name: 'Mrs A',
        invitationId: inv.body.invitationId,
      })
      .expect(200);
    await agent
      .post('/v1/auth/organization/accept-invitation')
      .send({ invitationId: inv.body.invitationId })
      .expect(200);
    const after = (await admin.get('/v1/owners').expect(200)).body.items[0];
    expect(after).toMatchObject({ portalStatus: 'active', userId: expect.any(String) });
  });

  it('frontdesk can read inventory but not write; frontdesk cannot see owners', async () => {
    const fd = (await signInAs(t, 'frontdesk', orgId)).agent;
    await fd.get('/v1/properties').expect(200);
    await fd.post('/v1/properties').send(prop()).expect(403);
    await fd.get('/v1/owners').expect(403);
  });

  it('unit fee override is stored and used', async () => {
    const p = (await admin.post('/v1/properties').send(prop()).expect(201)).body;
    const u = (
      await admin
        .post('/v1/units')
        .send(
          unit(p.id, { feeOverride: true, feeType: 'pct_net', feeBps: 1500, feeFixedMonthlyKobo: 5_000_000 }),
        )
        .expect(201)
    ).body;
    expect(u).toMatchObject({
      feeOverride: true,
      feeType: 'pct_net',
      feeBps: 1500,
      feeFixedMonthlyKobo: 5_000_000,
    });
  });
});
