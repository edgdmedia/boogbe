import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { SitePayload } from '@boogbe/shared';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, seedOrgSettings } from './helpers/users';
import { newId } from '../src/common/db/ids';

// T-WL-06: the public /site/version and /site endpoints — versioned immutable caching,
// the 302 on a stale v, published+ready content only, and UNAVAILABLE parity with WB.
describe('public site payload [WL]', () => {
  let t: TestApp;
  let m: Client;
  let orgId: string;
  let slug: string;

  beforeAll(async () => {
    process.env.MEDIA_PUBLIC_BASE = 'https://media.boogbe.test';
    t = await createTestApp();
  });
  afterAll(async () => {
    await m?.end();
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll();
    m = await migratorClient();
    const org = await seedOrg();
    orgId = org.id;
    slug = org.slug;
    await seedOrgSettings(orgId);
  });

  const version = async () => {
    const r = await t.http.get(`/v1/public/${slug}/site/version`).expect(200);
    return r.body.version as number;
  };

  /** A published (or draft) listing with one linked unit, two ready photos and one processing photo. */
  async function fixtureListing(published: boolean, slugName = 'destiny') {
    const listingId = newId();
    const propId = newId();
    const unitId = newId();
    await m.query(
      `insert into listing(id, org_id, name, slug, intro, description, published, published_at, updated_at)
       values ($1,$2,'Destiny',$3,'i','d',$4,now(),now())`,
      [listingId, orgId, slugName, published],
    );
    await m.query(
      `insert into property(id, org_id, name, address, updated_at) values ($1,$2,'The Rock','Lekki Phase 1',now())`,
      [propId, orgId],
    );
    await m.query(
      `insert into unit(id, org_id, property_id, name, bedrooms, max_guests, nightly_rate_kobo, active, public_listed, listing_id, listing_label, updated_at)
       values ($1,$2,$3,'Destiny 1',1,2,17500000,true,true,$4,'1 bedroom',now())`,
      [unitId, orgId, propId, listingId],
    );
    await m.query(
      `insert into unit_fee(id, org_id, unit_id, kind, label, amount_kobo, basis, refundable, active, updated_at)
       values ($1,$2,$3,'caution_deposit','Caution',10000000,'per_stay',true,true,now())`,
      [newId(), orgId, unitId],
    );
    for (const [alt, ready, order] of [
      ['Bed', true, 0],
      ['Living', true, 1],
      ['Kitchen', false, 2],
    ] as const) {
      const fileId = newId();
      await m.query(
        `insert into file(id, org_id, key, kind, content_type, size_bytes, confirmed) values ($1,$2,$3,'listing_photo','image/jpeg',100,true)`,
        [fileId, orgId, `org/${orgId}/listing_photo/${fileId}.jpg`],
      );
      await m.query(
        `insert into listing_photo(id, org_id, listing_id, file_id, alt, category, width, height, sort_order, variants, variants_ready)
         values ($1,$2,$3,$4,$5,'Bedrooms',800,600,$6,'{480,800}',$7)`,
        [newId(), orgId, listingId, fileId, alt, order, ready],
      );
    }
    return { listingId, unitId };
  }

  it('serves a SitePayload-valid body with published listings, ready photos and bookable units', async () => {
    const { listingId } = await fixtureListing(true);
    await fixtureListing(false, 'kairo-draft'); // a draft that must not appear
    await m.query(`update org_settings set public_enabled=true where org_id=$1`, [orgId]);

    const v = await version();
    const r = await t.http.get(`/v1/public/${slug}/site?v=${v}`).expect(200);
    expect(() => SitePayload.parse(r.body)).not.toThrow();
    expect(r.body.version).toBe(v);
    expect(r.body.org).toEqual({ name: expect.any(String), slug });
    expect(r.body.listings).toHaveLength(1);
    expect(r.body.listings[0].id).toBe(listingId);
    expect(r.body.listings[0].address).toBe('Lekki Phase 1'); // the estate address from the first linked unit's property (T-WL-06b)
    expect(r.body.listings[0].photos.map((p: { alt: string }) => p.alt)).toEqual(['Bed', 'Living']); // ready only, in order
    const p0 = r.body.listings[0].photos[0];
    expect(p0).toMatchObject({ widths: [480, 800], category: 'Bedrooms', alt: 'Bed', width: 800, height: 600 });
    expect(p0.src).toBe(`https://media.boogbe.test/org/${orgId}/listing/${p0.id}`);
    expect(r.body.listings[0].units).toEqual([
      {
        id: expect.any(String),
        label: '1 bedroom',
        bedrooms: 1,
        maxGuests: 2,
        nightlyRateKobo: 17_500_000,
        depositKobo: 10_000_000,
        bookable: true,
      },
    ]);
  });

  it('a unit with no deposit fee carries depositKobo 0', async () => {
    const { unitId } = await fixtureListing(true);
    await m.query(`delete from unit_fee where unit_id=$1`, [unitId]);
    const v = await version();
    const r = await t.http.get(`/v1/public/${slug}/site?v=${v}`).expect(200);
    expect(r.body.listings[0].units[0].depositKobo).toBe(0);
  });

  it('online booking switched off: /site is still 200 and every unit is bookable=false', async () => {
    await fixtureListing(true);
    // public_enabled stays false (the org_settings default).
    const v = await version();
    const r = await t.http.get(`/v1/public/${slug}/site?v=${v}`).expect(200);
    expect(r.body.listings[0].units[0].bookable).toBe(false);
  });

  it('an archived unit drops to bookable=false but the listing still renders', async () => {
    const { unitId } = await fixtureListing(true);
    await m.query(`update unit set active=false where id=$1`, [unitId]);
    const v = await version();
    const r = await t.http.get(`/v1/public/${slug}/site?v=${v}`).expect(200);
    expect(r.body.listings).toHaveLength(1);
    expect(r.body.listings[0].units[0].bookable).toBe(false);
  });

  it('missing or stale v gives 302 to the current version with no-store; the current v is immutable', async () => {
    await fixtureListing(true);
    const v = await version();

    const miss = await t.http.get(`/v1/public/${slug}/site`).expect(302);
    expect(miss.headers.location).toBe(`/v1/public/${slug}/site?v=${v}`);
    expect(miss.headers['cache-control']).toBe('no-store');

    const stale = await t.http.get(`/v1/public/${slug}/site?v=${v - 1}`).expect(302);
    expect(stale.headers.location).toBe(`/v1/public/${slug}/site?v=${v}`);

    const good = await t.http.get(`/v1/public/${slug}/site?v=${v}`).expect(200);
    expect(good.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(good.body.version).toBe(v);
  });

  it('/site/version sends max-age=15 and follows site_version bumps', async () => {
    const r = await t.http.get(`/v1/public/${slug}/site/version`).expect(200);
    expect(r.headers['cache-control']).toBe('public, max-age=15');
    const before = r.body.version;
    await m.query(`update org_settings set site_version = site_version + 1 where org_id=$1`, [orgId]);
    expect(await version()).toBe(before + 1);
  });

  it('oldSlugs come from history, never the current slug', async () => {
    const { listingId } = await fixtureListing(true);
    await m.query(`insert into listing_slug_history(id, org_id, listing_id, slug) values ($1,$2,$3,'destiny-ikate')`, [
      newId(),
      orgId,
      listingId,
    ]);
    await m.query(`insert into listing_slug_history(id, org_id, listing_id, slug) values ($1,$2,$3,'destiny')`, [
      newId(),
      orgId,
      listingId,
    ]); // a stray current-slug row must be filtered
    const v = await version();
    const r = await t.http.get(`/v1/public/${slug}/site?v=${v}`).expect(200);
    expect(r.body.listings[0].oldSlugs.sort()).toEqual(['destiny-ikate']);
  });

  it('unknown and suspended orgs give the same 404 UNAVAILABLE as WB', async () => {
    for (const path of ['/site/version', '/site?v=1']) {
      const r = await t.http.get(`/v1/public/no-such-org${path}`).expect(404);
      expect(r.body.error.code).toBe('UNAVAILABLE');
    }
    await fixtureListing(true);
    await m.query(`update organization set status='suspended' where id=$1`, [orgId]);
    const r = await t.http.get(`/v1/public/${slug}/site/version`).expect(404);
    expect(r.body.error.code).toBe('UNAVAILABLE');
  });

  it('the payload carries no member, guest or internal data', async () => {
    await fixtureListing(true);
    await m.query(`update property set notes='Gym is currently listed as inactive'`, []);
    await m.query(`update unit set check_in_instructions='Gate code 1234'`, []);
    const v = await version();
    const r = await t.http.get(`/v1/public/${slug}/site?v=${v}`).expect(200);
    const json = JSON.stringify(r.body);
    for (const forbidden of ['inactive', 'Gate code 1234', 'notes', 'checkInInstructions', 'check_in', 'member', 'guest'])
      expect(json).not.toContain(forbidden);
  });

  it('CORS on /site uses the org public_origins even with booking off', async () => {
    await fixtureListing(true);
    await m.query(`update org_settings set public_origins='{https://tanuhomes.com}' where org_id=$1`, [orgId]);
    const v = await version();
    const ok = await t.http.get(`/v1/public/${slug}/site?v=${v}`).set('Origin', 'https://tanuhomes.com').expect(200);
    expect(ok.headers['access-control-allow-origin']).toBe('https://tanuhomes.com');
    const no = await t.http.get(`/v1/public/${slug}/site?v=${v}`).set('Origin', 'https://evil.example').expect(200);
    expect(no.headers['access-control-allow-origin']).toBeUndefined();
  });
});
