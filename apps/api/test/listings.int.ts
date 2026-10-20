import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, seedOrgSettings, signInAs, type Agent } from './helpers/users';
import { seedProperty, seedUnit } from './helpers/inventory';
import { newId } from '../src/common/db/ids';

// T-WL-04: the listings CRUD API. Every write bumps site_version exactly once, audits,
// and enforces the plan's rules (STALE, SLUG_TAKEN, UNIT_LINKED, PUBLISH_BLOCKED).
describe('listings api [WL]', () => {
  let t: TestApp;
  let m: Client;
  let admin: Agent;
  let orgId: string;
  let propId: string;

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
    admin = (await signInAs(t, 'admin', orgId)).agent;
  });

  const version = async () =>
    Number((await m.query('select site_version from org_settings where org_id=$1', [orgId])).rows[0].site_version);

  const create = (body: Record<string, unknown>) => admin.post('/v1/listings').send(body);

  const text = { name: 'Destiny', intro: 'A calm two-bedroom.', description: 'Sea breeze, quiet street.' };

  /** Seed a ready photo directly (attach is T-WL-05). */
  async function seedReadyPhoto(listingId: string, alt = 'Bedroom') {
    const fileId = newId();
    const photoId = newId();
    await m.query(
      `insert into file(id, org_id, key, kind, content_type, size_bytes, confirmed)
       values ($1,$2,$3,'listing_photo','image/jpeg',100,true)`,
      [fileId, orgId, `org/${orgId}/listing/${fileId}.jpg`],
    );
    await m.query(
      `insert into listing_photo(id, org_id, listing_id, file_id, alt, category, width, height, variants, variants_ready)
       values ($1,$2,$3,$4,$5,'Bedrooms',4000,3000,'{480,800}',true)`,
      [photoId, orgId, listingId, fileId, alt],
    );
    return photoId;
  }

  it('CRUD round trip: create, read, patch, list', async () => {
    const c = await create({ ...text, area: 'Ikate, Lekki', amenities: ['24/7 power'] }).expect(201);
    expect(c.body).toMatchObject({ name: 'Destiny', slug: 'destiny', published: false, amenities: ['24/7 power'], sortOrder: 0 });
    expect(typeof c.body.updatedAt).toBe('string');
    const g = await admin.get(`/v1/listings/${c.body.id}`).expect(200);
    expect(g.body.slug).toBe('destiny');
    const p = await admin
      .patch(`/v1/listings/${c.body.id}`)
      .send({ highlight: 'Sea breeze', expectedUpdatedAt: g.body.updatedAt })
      .expect(200);
    expect(p.body.highlight).toBe('Sea breeze');
    const l = await admin.get('/v1/listings').expect(200);
    expect(l.body.items.map((x: { id: string }) => x.id)).toEqual([c.body.id]);
  });

  it('the slug defaults to slugify(name) and gains -2, -3 on collision', async () => {
    const a = await create(text).expect(201);
    expect(a.body.slug).toBe('destiny');
    const b = await create({ ...text, name: 'Destiny ' }).expect(201); // slugifies to the same base
    expect(b.body.slug).toBe('destiny-2');
    const c = await create({ ...text, name: 'DESTINY' }).expect(201);
    expect(c.body.slug).toBe('destiny-3');
  });

  it('slug history a→b→c→a: history holds {b,c} and a is freed back to this listing', async () => {
    const l = await create({ ...text, name: 'Alpha' }).expect(201); // base slug 'alpha', never listed as old again
    expect(l.body.slug).toBe('alpha');
    let updatedAt = l.body.updatedAt;
    const rename = async (slug: string) => {
      const r = await admin.patch(`/v1/listings/${l.body.id}`).send({ slug, expectedUpdatedAt: updatedAt }).expect(200);
      updatedAt = r.body.updatedAt;
      return r;
    };
    await rename('b');
    await rename('c');
    const back = await rename('alpha'); // its own history row — allowed and removed
    expect(back.body.slug).toBe('alpha');
    const rows = await m.query('select slug from listing_slug_history where listing_id=$1 order by slug', [l.body.id]);
    expect(rows.rows.map((r) => r.slug)).toEqual(['b', 'c']); // the current slug is never listed as old
  });

  it('taking another listing’s historical slug gives 409 SLUG_TAKEN', async () => {
    const a = await create(text).expect(201);
    await admin.patch(`/v1/listings/${a.body.id}`).send({ slug: 'alaska-old', expectedUpdatedAt: a.body.updatedAt }).expect(200);
    const b = await create({ ...text, name: 'Ebony' }).expect(201);
    const r = await admin
      .patch(`/v1/listings/${b.body.id}`)
      .send({ slug: 'alaska-old', expectedUpdatedAt: b.body.updatedAt })
      .expect(409);
    expect(r.body.error.code).toBe('SLUG_TAKEN');
  });

  it('an old expectedUpdatedAt gives 409 STALE with the current updatedAt and who set it', async () => {
    const a = await create(text).expect(201);
    const r = await admin
      .patch(`/v1/listings/${a.body.id}`)
      .send({ intro: 'Changed by someone else', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' })
      .expect(409);
    expect(r.body.error.code).toBe('STALE');
    expect(r.body.error.details.updatedAt).toBe(a.body.updatedAt);
    expect(r.body.error.details.updatedBy).toBe('Test User');
  });

  it('PUT units links with labels, clears removed ones, and refuses another listing’s unit', async () => {
    const u1 = await seedUnit(orgId, propId, { name: 'Destiny 1' });
    const u2 = await seedUnit(orgId, propId, { name: 'Destiny 2' });
    const a = await create(text).expect(201);
    const b = await create({ ...text, name: 'Kairo' }).expect(201);

    await admin.put(`/v1/listings/${a.body.id}/units`).send([{ unitId: u1, label: '1 bedroom' }, { unitId: u2, label: null }]).expect(200);
    expect((await m.query('select listing_id, listing_label from unit where id=$1', [u1])).rows[0]).toEqual({
      listing_id: a.body.id,
      listing_label: '1 bedroom',
    });

    const r = await admin.put(`/v1/listings/${b.body.id}/units`).send([{ unitId: u1, label: 'stolen' }]).expect(409);
    expect(r.body.error.code).toBe('UNIT_LINKED');

    // Replacing a's units with only u2 clears u1's link.
    await admin.put(`/v1/listings/${a.body.id}/units`).send([{ unitId: u2, label: '2 bedrooms' }]).expect(200);
    expect((await m.query('select listing_id from unit where id=$1', [u1])).rows[0].listing_id).toBe(null);

    const got = await admin.get(`/v1/listings/${a.body.id}`).expect(200);
    expect(got.body.units).toEqual([
      { id: u2, name: 'Destiny 2', label: '2 bedrooms', nightlyRateKobo: 20_000_000, maxGuests: 4, bookable: false },
    ]);
    // bookable = active && publicListed && property active — publicListed is still false.
    await admin.patch(`/v1/units/${u2}`).send({ publicListed: true }).expect(200);
    const again = await admin.get(`/v1/listings/${a.body.id}`).expect(200);
    expect(again.body.units[0].bookable).toBe(true);
  });

  it('PUT order sets sort_order by position', async () => {
    const a = await create({ ...text, name: 'Alaska' }).expect(201);
    const b = await create({ ...text, name: 'Kairo' }).expect(201);
    await admin.put('/v1/listings/order').send({ ids: [b.body.id, a.body.id] }).expect(200);
    const l = await admin.get('/v1/listings').expect(200);
    expect(l.body.items.map((x: { name: string }) => x.name)).toEqual(['Kairo', 'Alaska']);
  });

  it('publish on an incomplete draft gives 422 PUBLISH_BLOCKED with the blocker list', async () => {
    const a = await create({ name: 'Empty' }).expect(201);
    const r = await admin.post(`/v1/listings/${a.body.id}/publish`).expect(422);
    expect(r.body.error.code).toBe('PUBLISH_BLOCKED');
    expect(r.body.error.details.blockers).toEqual([
      'Add an intro',
      'Add a description',
      'Add at least 3 photos',
      'Every photo needs a description',
      'Choose a cover photo',
      'Link at least one unit',
    ]);
  });

  it('publish succeeds from the API once every blocker clears', async () => {
    const u = await seedUnit(orgId, propId, { name: 'Destiny 1' });
    const a = await create(text).expect(201);
    await admin.put(`/v1/listings/${a.body.id}/units`).send([{ unitId: u, label: null }]).expect(200);
    const photos = [await seedReadyPhoto(a.body.id), await seedReadyPhoto(a.body.id), await seedReadyPhoto(a.body.id)];
    await m.query('update listing set cover_photo_id=$2 where id=$1', [a.body.id, photos[0]]);
    const r = await admin.post(`/v1/listings/${a.body.id}/publish`).expect(200);
    expect(r.body.published).toBe(true);
    expect(typeof r.body.publishedAt).toBe('string');
    const u2 = await admin.post(`/v1/listings/${a.body.id}/unpublish`).expect(200);
    expect(u2.body.published).toBe(false);
  });

  it('delete refuses listings with slug history (PUBLISHED_BEFORE) and removes clean drafts', async () => {
    const a = await create(text).expect(201);
    await admin.patch(`/v1/listings/${a.body.id}`).send({ slug: 'other', expectedUpdatedAt: a.body.updatedAt }).expect(200);
    const bad = await admin.delete(`/v1/listings/${a.body.id}`).expect(409);
    expect(bad.body.error.code).toBe('PUBLISHED_BEFORE');

    const b = await create({ ...text, name: 'Kairo' }).expect(201);
    const before = await version();
    await admin.delete(`/v1/listings/${b.body.id}`).expect(200);
    expect(await admin.get(`/v1/listings/${b.body.id}`).expect(404));
    expect(await version()).toBe(before + 1);
  });

  it('a front-desk role can read but gets 403 on every write', async () => {
    const fd = (await signInAs(t, 'frontdesk', orgId)).agent;
    await fd.get('/v1/listings').expect(200);
    await fd.post('/v1/listings').send(text).expect(403);
    const a = await create(text).expect(201);
    await fd.patch(`/v1/listings/${a.body.id}`).send({ intro: 'x', expectedUpdatedAt: a.body.updatedAt }).expect(403);
    await fd.put(`/v1/listings/${a.body.id}/units`).send([]).expect(403);
    await fd.post(`/v1/listings/${a.body.id}/publish`).expect(403);
    await fd.delete(`/v1/listings/${a.body.id}`).expect(403);
  });

  it('every write bumps site_version exactly once', async () => {
    const u = await seedUnit(orgId, propId, { name: 'Destiny 1' });
    let v = await version();
    const expectBump = async (label: string, fn: () => Promise<unknown>) => {
      await fn();
      const after = await version();
      expect(after, label).toBe(v + 1);
      v = after;
    };
    let created: { id: string };
    await expectBump('create', async () => {
      created = (await create(text).expect(201)).body as { id: string };
    });
    const fresh = () => admin.get(`/v1/listings/${created!.id}`).then((r) => r.body.updatedAt as string);
    await expectBump('patch', async () => {
      // Read the current updatedAt BEFORE building the PATCH request: supertest starts/closes an
      // ephemeral listen per request, and an interleaved GET breaks the pending PATCH's connect.
      const at = await fresh();
      return admin.patch(`/v1/listings/${created!.id}`).send({ area: 'Ikate', expectedUpdatedAt: at });
    });
    await expectBump('units', () => admin.put(`/v1/listings/${created!.id}/units`).send([{ unitId: u, label: '1 bedroom' }]));
    await expectBump('order', () => admin.put('/v1/listings/order').send({ ids: [created!.id] }));
    // make it publishable, then publish, unpublish, delete
    await seedReadyPhoto(created!.id);
    await seedReadyPhoto(created!.id);
    await seedReadyPhoto(created!.id);
    const cover = (await m.query('select id from listing_photo where listing_id=$1 limit 1', [created!.id])).rows[0].id;
    await m.query('update listing set cover_photo_id=$2 where id=$1', [created!.id, cover]);
    v = await version(); // the direct fixture writes are not API writes; re-anchor
    await expectBump('publish', () => admin.post(`/v1/listings/${created!.id}/publish`));
    await expectBump('unpublish', () => admin.post(`/v1/listings/${created!.id}/unpublish`));
    await expectBump('delete', () => admin.delete(`/v1/listings/${created!.id}`));
  });

  it('audits each action', async () => {
    const a = await create(text).expect(201);
    await admin.put(`/v1/listings/${a.body.id}/units`).send([]).expect(200);
    const rows = await m.query("select action from audit_log where entity='listing' and entity_id=$1 order by at, action", [a.body.id]);
    expect(rows.rows.map((r) => r.action)).toEqual(['listing.created', 'listing.units_set']);
  });
});
