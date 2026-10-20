import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, seedOrgSettings, signInAs, type Agent } from './helpers/users';
import { seedProperty, seedUnit } from './helpers/inventory';
import { newId } from '../src/common/db/ids';

// T-WL-03: every write that changes what /site shows bumps org_settings.site_version by exactly 1,
// in the same transaction; every other write leaves it alone. The table is the plan's matrix.
describe('site_version bumps [WL]', () => {
  let t: TestApp;
  let m: import('pg').Client;
  let admin: Agent;
  let orgId: string;
  let propId: string;
  let unitId: string; // linked to a listing
  let unlinkedId: string; // no listing

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await m?.end();
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll();
    m = await migratorClient();
    orgId = (await seedOrg()).id;
    await seedOrgSettings(orgId);
    propId = await seedProperty(orgId);
    unitId = await seedUnit(orgId, propId, { name: 'Destiny 1' });
    unlinkedId = await seedUnit(orgId, propId, { name: 'Store room' });
    const listingId = newId();
    await m.query(`insert into listing(id, org_id, name, slug, updated_at) values ($1,$2,'Destiny','destiny',now())`, [
      listingId,
      orgId,
    ]);
    await m.query('update unit set listing_id=$2 where id=$1', [unitId, listingId]);
    admin = (await signInAs(t, 'admin', orgId)).agent;
  });

  const version = async () =>
    Number((await m.query('select site_version from org_settings where org_id=$1', [orgId])).rows[0].site_version);

  /** Runs fn and asserts site_version moved by exactly `want`. */
  async function bump(want: 0 | 1, fn: () => Promise<unknown>) {
    const before = await version();
    await fn();
    expect(await version()).toBe(before + want);
  }

  it('starts at 1', async () => expect(await version()).toBe(1));

  // ── these must give +1 ──

  it('unit rate change on a linked unit bumps once', async () => {
    await bump(1, () => admin.patch(`/v1/units/${unitId}`).send({ nightlyRateKobo: 21_000_000 }).expect(200));
  });

  it('maxGuests change bumps once', async () => {
    await bump(1, () => admin.patch(`/v1/units/${unitId}`).send({ maxGuests: 5 }).expect(200));
  });

  it('name change bumps once', async () => {
    await bump(1, () => admin.patch(`/v1/units/${unitId}`).send({ name: 'Destiny One' }).expect(200));
  });

  it('archiving a linked unit bumps once (and so does unarchiving)', async () => {
    await bump(1, () => admin.post(`/v1/units/${unitId}/archive`).expect(200));
    await bump(1, () => admin.post(`/v1/units/${unitId}/unarchive`).expect(200));
  });

  it('the publicListed toggle bumps once', async () => {
    await bump(1, () => admin.patch(`/v1/units/${unitId}`).send({ publicListed: true }).expect(200));
  });

  it('fee writes on a linked unit bump: create, update, archive', async () => {
    let feeId = '';
    await bump(1, async () => {
      feeId = (
        await admin
          .post(`/v1/units/${unitId}/fees`)
          .send({ kind: 'caution_deposit', label: 'Caution', amountKobo: 5_000_000, basis: 'per_stay' })
          .expect(201)
      ).body.id;
    });
    await bump(1, () => admin.patch(`/v1/fees/${feeId}`).send({ amountKobo: 6_000_000 }).expect(200));
    await bump(1, () => admin.post(`/v1/fees/${feeId}/archive`).expect(200));
  });

  it('archiving a property with a linked unit bumps once', async () => {
    await bump(1, () => admin.post(`/v1/properties/${propId}/archive`).expect(200));
  });

  it('the public_enabled toggle bumps once', async () => {
    await bump(1, () => admin.patch('/v1/org/settings').send({ publicEnabled: true }).expect(200));
  });

  // ── these must give +0 ──

  it('a rate change on an unlinked unit does not bump', async () => {
    await bump(0, () => admin.patch(`/v1/units/${unlinkedId}`).send({ nightlyRateKobo: 25_000_000 }).expect(200));
  });

  it('a checkInInstructions change does not bump', async () => {
    await bump(0, () => admin.patch(`/v1/units/${unitId}`).send({ checkInInstructions: 'Gate code 1234' }).expect(200));
  });

  it('a fee write on an unlinked unit does not bump', async () => {
    await bump(0, async () => {
      await admin
        .post(`/v1/units/${unlinkedId}/fees`)
        .send({ kind: 'caution_deposit', label: 'Caution', amountKobo: 5_000_000, basis: 'per_stay' })
        .expect(201);
    });
  });

  it('archiving a property whose units are all unlinked does not bump', async () => {
    await m.query('update unit set listing_id=null');
    await bump(0, () => admin.post(`/v1/properties/${propId}/archive`).expect(200));
  });

  it('creating a block does not bump', async () => {
    await bump(0, () =>
      admin
        .post('/v1/blocks')
        .send({ unitId, start: '2027-01-10', end: '2027-01-12', reason: 'maintenance' })
        .expect(201),
    );
  });

  it('a failed write does not bump', async () => {
    const before = await version();
    await admin.patch(`/v1/units/${unitId}`).send({ maxGuests: 0 }).expect(400);
    expect(await version()).toBe(before);
  });
});
