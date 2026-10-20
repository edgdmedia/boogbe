import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, seedOrgSettings } from './helpers/users';
import { OrgDb } from '../src/common/db/org-db.service';
import { newId } from '../src/common/db/ids';

describe('0009 website listings schema', () => {
  let t: TestApp;
  let db: OrgDb;
  let m: Client;
  let app: Client;

  beforeAll(async () => {
    t = await createTestApp();
    db = t.app.get(OrgDb);
    m = await migratorClient();
    app = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await app.connect();
  });
  afterAll(async () => {
    await m.end();
    await app.end();
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  // The fixed list from the WL plan's Global Constraints, in order.
  const CATEGORIES = [
    'Living spaces',
    'Bedrooms',
    'Kitchen & dining',
    'Bathrooms',
    'Outdoor spaces',
    'Building & shared spaces',
    'Cinema & leisure',
    'Design details',
  ];

  /** A listing with one file-backed photo, the way the API would create them. */
  async function seedListing(orgId: string, slug = 'destiny') {
    return db.run(orgId, async (tx) => {
      const listing = await tx.listing.create({ data: { id: newId(), name: 'Destiny', slug } as never });
      const file = await tx.file.create({
        data: {
          id: newId(),
          key: `org/${orgId}/listing/${newId()}-orig.jpg`,
          kind: 'listing_photo',
          contentType: 'image/jpeg',
          sizeBytes: 1000,
        } as never,
      });
      const photo = await tx.listingPhoto.create({
        data: { id: newId(), listingId: listing.id, fileId: file.id, category: 'Bedrooms' } as never,
      });
      return { listing, file, photo };
    });
  }

  it('hides one org listing, photo and slug history rows from another org', async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const { listing, photo } = await seedListing(a.id);
    await db.run(a.id, (tx) =>
      tx.listingSlugHistory.create({ data: { id: newId(), listingId: listing.id, slug: 'destiny-ikate' } as never }),
    );

    await db.run(b.id, async (tx) => {
      expect(await tx.listing.findMany()).toEqual([]);
      expect(await tx.listingPhoto.findMany()).toEqual([]);
      expect(await tx.listingSlugHistory.findMany()).toEqual([]);
      expect(await tx.listing.findUnique({ where: { id: listing.id } })).toBeNull();
      expect(await tx.listingPhoto.findUnique({ where: { id: photo.id } })).toBeNull();
    });

    // The app role without any org context sees nothing either (RLS is forced).
    const counts = await app.query(
      `select (select count(*) from listing) as l,
              (select count(*) from listing_photo) as p,
              (select count(*) from listing_slug_history) as h`,
    );
    expect(counts.rows[0]).toEqual({ l: '0', p: '0', h: '0' });
  });

  it('rejects a duplicate slug in one org but allows the same slug in another org', async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    await seedListing(a.id, 'alaska');
    const dup = await db
      .run(a.id, (tx) => tx.listing.create({ data: { id: newId(), name: 'Other', slug: 'alaska' } as never }))
      .catch((e) => e);
    expect(dup.code).toBe('P2002'); // listing_org_id_slug_key
    await seedListing(a.id, 'kairo'); // a different slug in the same org is fine
    await seedListing(b.id, 'alaska'); // same slug, different org — allowed
  });

  it('accepts the eight fixed photo categories and rejects anything else', async () => {
    const a = await seedOrg();
    const { listing } = await seedListing(a.id);
    for (const category of CATEGORIES) {
      await db.run(a.id, async (tx) => {
        const file = await tx.file.create({
          data: {
            id: newId(),
            key: `org/${a.id}/listing/${newId()}-orig.jpg`,
            kind: 'listing_photo',
            contentType: 'image/jpeg',
            sizeBytes: 1000,
          } as never,
        });
        return tx.listingPhoto.create({
          data: { id: newId(), listingId: listing.id, fileId: file.id, category } as never,
        });
      });
    }
    await expect(
      db.run(a.id, async (tx) => {
        const file = await tx.file.create({
          data: {
            id: newId(),
            key: `org/${a.id}/listing/${newId()}-orig.jpg`,
            kind: 'listing_photo',
            contentType: 'image/jpeg',
            sizeBytes: 1000,
          } as never,
        });
        return tx.listingPhoto.create({
          data: { id: newId(), listingId: listing.id, fileId: file.id, category: 'Garden' } as never,
        });
      }),
    ).rejects.toThrow(/listing_photo_category_chk/);
  });

  it('deleting a listing deletes its photos and clears the unit link', async () => {
    const a = await seedOrg();
    const { listing, photo } = await seedListing(a.id);
    const unitId = await db.run(a.id, async (tx) => {
      const p = await tx.property.create({ data: { id: newId(), name: 'Rock', address: 'Lekki' } as never });
      const u = await tx.unit.create({
        data: { id: newId(), propertyId: p.id, name: 'Destiny 1', bedrooms: 1, maxGuests: 2, nightlyRateKobo: 17_500_000n } as never,
      });
      await tx.unit.updateMany({ where: { id: u.id }, data: { listingId: listing.id, listingLabel: '1 bedroom' } as never });
      return u.id;
    });

    await db.run(a.id, (tx) => tx.listing.delete({ where: { id: listing.id } }));

    expect((await m.query('select 1 from listing_photo where id=$1', [photo.id])).rows).toEqual([]);
    const unit = await m.query('select listing_id from unit where id=$1', [unitId]);
    expect(unit.rows[0].listing_id).toBe(null);
  });

  it('public_site_lookup resolves an active org whatever public_enabled says, and nothing when suspended', async () => {
    const org = await seedOrg();
    await m.query(`update organization set slug='tanuhomes' where id=$1`, [org.id]);
    await seedOrgSettings(org.id);

    // Booking switched off must not take the apartment pages down (plan deviation 4).
    expect((await app.query('select * from public_site_lookup($1)', ['tanuhomes'])).rows).toEqual([
      { org_id: org.id, timezone: 'Africa/Lagos', public_enabled: false, public_origins: [] },
    ]);

    await m.query(`update organization set status='suspended' where id=$1`, [org.id]);
    expect((await app.query('select * from public_site_lookup($1)', ['tanuhomes'])).rows).toEqual([]);
    expect((await app.query('select * from public_site_lookup($1)', ['no-such-org'])).rows).toEqual([]);
  });

  it('only the app role may execute public_site_lookup', async () => {
    const priv = await m.query(
      `select has_function_privilege('public', 'public_site_lookup(text)', 'execute') as anyone,
              has_function_privilege('boogbe_app', 'public_site_lookup(text)', 'execute') as app`,
    );
    expect(priv.rows[0]).toEqual({ anyone: false, app: true });
  });

  it('site_version defaults to 1', async () => {
    const org = await seedOrg();
    await seedOrgSettings(org.id);
    const s = await m.query('select site_version from org_settings where org_id=$1', [org.id]);
    expect(s.rows[0].site_version).toBe('1'); // pg returns bigint as a string
  });
});
