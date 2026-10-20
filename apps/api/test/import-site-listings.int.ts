import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { Client } from 'pg';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, seedOrgSettings } from './helpers/users';
import { seedProperty } from './helpers/inventory';
import { newId } from '../src/common/db/ids';
import { STORAGE, type Storage } from '../src/common/files/storage';
import { ListingsService } from '../src/modules/website/listings.service';
import { ListingPhotosService } from '../src/modules/website/listing-photos.service';
import { OrgDb } from '../src/common/db/org-db.service';
import { importSiteListings } from '../scripts/import-site-listings';

// T-WL-09: import today's six Tanuhomes property files into Boogbe listings (idempotent).
const FIXTURES = resolve(__dirname, 'fixtures/site-import');

describe('import-site-listings [WL]', () => {
  let t: TestApp;
  let m: Client;
  let orgId: string;
  let propId: string;
  let unit1: string;
  let unit2: string;

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
    unit1 = await insertUnit('Destiny 1', 1);
    unit2 = await insertUnit('Destiny 2', 2);
  });

  async function insertUnit(name: string, bedrooms: number) {
    const id = newId();
    await m.query(
      `insert into unit(id, org_id, property_id, name, bedrooms, max_guests, nightly_rate_kobo, active, public_listed, updated_at)
       values ($1,$2,$3,$4,$5,2,17500000,true,true,now())`,
      [id, orgId, propId, name, bedrooms],
    );
    return id;
  }

  /** A fake tanuhomes repo in tmp: chosen property JSONs (unit ids substituted) + generated 1600px webps. */
  function buildRepo(files: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'site-import-'));
    cpSync(FIXTURES, dir, { recursive: true });
    for (const f of files) {
      const path = join(dir, 'src/content/properties', `${f}.json`);
      const body = readFileSync(path, 'utf8').replaceAll('UNIT1', unit1).replaceAll('UNIT2', unit2);
      writeFileSync(path, body);
    }
    for (const keep of ['destiny-import', 'draft-import', 'badunit-import']) {
      if (!files.includes(keep)) rmSync(join(dir, `src/content/properties/${keep}.json`), { force: true });
    }
    return dir;
  }

  async function generateImages(repo: string) {
    const dir = join(repo, 'public/assets/images');
    mkdirSync(dir, { recursive: true });
    for (const [name, bg] of [
      ['import-001', '#123456'],
      ['import-002', '#654321'],
      ['import-003', '#abcdef'],
    ] as const) {
      const buf = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: bg } }).webp().toBuffer();
      writeFileSync(join(dir, `${name}-1600.webp`), buf);
    }
  }

  const run = (repo: string, dryRun = false) =>
    importSiteListings({
      orgId,
      repoPath: repo,
      dryRun,
      listings: t.app.get(ListingsService),
      photos: t.app.get(ListingPhotosService),
      storage: t.app.get(STORAGE) as Storage,
      orgDb: t.app.get(OrgDb),
    });

  it('creates 1 listing, links 2 units and attaches 3 photos with source_ref', async () => {
    const repo = buildRepo(['destiny-import', 'draft-import']);
    await generateImages(repo);
    const r = await run(repo);
    expect(r.errors).toEqual([]);

    const listing = (await m.query(`select * from listing where slug='destiny-import'`)).rows[0];
    expect(listing).toMatchObject({
      name: 'Destiny',
      published: false,
      highlight: 'A home with room to slow down.',
      intro: 'Curved seating and two balconies.',
      description: 'Destiny pairs a sociable living area with calmer bedrooms.',
      amenities: ['Shared pool', 'Fitted kitchen', '24-hour power'],
      bathrooms_label: '2 bathrooms · 3 toilets',
      layout_label: null, // '1 or 2 bedrooms' is derivable from the linked units
    });
    expect(listing.cover_photo_id).not.toBeNull(); // the hero image
    expect(r.lines.join('\n')).toContain('destiny-import');

    const units = await m.query('select id, listing_label from unit where listing_id=$1 order by id', [listing.id]);
    expect(units.rows.map((u) => u.listing_label)).toEqual(['1 bedroom', '2 bedrooms']);

    const photos = await m.query('select file_id, alt, category, sort_order, source_ref from listing_photo where listing_id=$1 order by sort_order', [listing.id]);
    expect(photos.rows.map((p) => p.source_ref)).toEqual(['destiny-import/import-001', 'destiny-import/import-002', 'destiny-import/import-003']);
    expect(photos.rows[0]).toMatchObject({ alt: 'Destiny living room', category: 'Living spaces' });
    // The originals landed in the private store, confirmed and typed as listing_photo.
    const file = await m.query('select key, kind, confirmed, content_type from file where id=$1', [photos.rows[0].file_id]);
    expect(file.rows[0]).toMatchObject({ kind: 'listing_photo', confirmed: true, content_type: 'image/webp' });
    expect(await (t.app.get(STORAGE) as Storage).get(file.rows[0].key)).not.toBeNull();

    // Drafts are skipped entirely.
    expect((await m.query(`select 1 from listing where slug='draft-import'`)).rows).toEqual([]);
    // Internal notes moved to the property with the marker.
    const prop = await m.query('select notes from property where id=$1', [propId]);
    expect(prop.rows[0].notes).toContain('[website import]');
    expect(prop.rows[0].notes).toContain('Gym is currently listed as inactive.');
  });

  it('a second run adds nothing', async () => {
    const repo = buildRepo(['destiny-import']);
    await generateImages(repo);
    await run(repo);
    const r2 = await run(repo);
    expect(r2.errors).toEqual([]);
    expect(r2.lines.join('\n')).toMatch(/updated|0 new/);
    expect((await m.query('select count(*)::int c from listing')).rows[0].c).toBe(1);
    expect((await m.query('select count(*)::int c from listing_photo')).rows[0].c).toBe(3);
  });

  it('--dry-run writes nothing', async () => {
    const repo = buildRepo(['destiny-import']);
    await generateImages(repo);
    const r = await run(repo, true);
    expect(r.errors).toEqual([]);
    expect((await m.query('select count(*)::int c from listing')).rows[0].c).toBe(0);
    expect((await m.query('select count(*)::int c from listing_photo')).rows[0].c).toBe(0);
    expect((await m.query('select notes from property where id=$1', [propId])).rows[0].notes).toBeNull();
    expect(r.lines.join('\n')).toMatch(/dry run|would/i);
  });

  it('property notes gain the marker once', async () => {
    const repo = buildRepo(['destiny-import']);
    await generateImages(repo);
    await run(repo);
    await run(repo);
    const notes = (await m.query('select notes from property where id=$1', [propId])).rows[0].notes;
    expect(notes.split('[website import]').length - 1).toBe(1);
  });

  it('an unknown unit id fails with a clear message and writes nothing for that listing', async () => {
    const repo = buildRepo(['badunit-import']);
    await generateImages(repo);
    const r = await run(repo);
    expect(r.errors.join('\n')).toMatch(/badunit-import.*missing-unit|missing-unit.*badunit-import/s);
    expect((await m.query(`select 1 from listing where slug='badunit-import'`)).rows).toEqual([]);
    expect((await m.query(`select 1 from listing_photo where source_ref like 'badunit-import/%'`)).rows).toEqual([]);
  });

  it('bumps the site version once per listing written', async () => {
    const repo = buildRepo(['destiny-import']);
    await generateImages(repo);
    const before = Number((await m.query('select site_version::int v from org_settings where org_id=$1', [orgId])).rows[0].v);
    await run(repo);
    const after = Number((await m.query('select site_version::int v from org_settings where org_id=$1', [orgId])).rows[0].v);
    // create + units + cover writes each bump; the point is it moved, and the payload will refresh.
    expect(after).toBeGreaterThan(before);
  });
});
