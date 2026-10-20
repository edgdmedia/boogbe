import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import sharp from 'sharp';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, seedOrgSettings, signInAs, type Agent } from './helpers/users';
import { newId } from '../src/common/db/ids';
import { MEDIA_STORAGE, STORAGE, type Storage } from '../src/common/files/storage';
import { PrismaService } from '../src/common/db/prisma.service';
import { OrgDb } from '../src/common/db/org-db.service';
import { JobRunner } from '../src/common/jobs/job-runner';
import { ListingPhotosJob } from '../src/modules/website/listing-photos.job';

// T-WL-05: photo attach/patch/order/cover/delete, the HEIC refusal, and the sharp resize job
// that turns originals into immutable WebP variants on the media bucket.
describe('listing photos [WL]', () => {
  let t: TestApp;
  let m: Client;
  let admin: Agent;
  let orgId: string;
  let listingId: string;

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
    orgId = (await seedOrg()).id;
    await seedOrgSettings(orgId);
    admin = (await signInAs(t, 'admin', orgId)).agent;
    listingId = (await admin.post('/v1/listings').send({ name: 'Destiny', intro: 'i', description: 'd' }).expect(201)).body.id;
  });

  const version = async () =>
    Number((await m.query('select site_version from org_settings where org_id=$1', [orgId])).rows[0].site_version);
  const storage = () => t.app.get(STORAGE) as Storage;
  const media = () => t.app.get(MEDIA_STORAGE) as Storage;
  // The job is worker-registered only (D-019); tests run its pass() directly, like outbox.int.
  const job = () =>
    new ListingPhotosJob(t.app.get(PrismaService), t.app.get(OrgDb), storage(), media(), new JobRunner(t.app.get(PrismaService)));

  /** presign → put the bytes the fake client would upload → confirm. */
  async function uploadOriginal(body: Buffer, contentType = 'image/jpeg'): Promise<string> {
    const pres = await admin
      .post('/v1/files/presign')
      .send({ kind: 'listing_photo', contentType, sizeBytes: body.length })
      .expect(201);
    await storage().put(String(pres.body.uploadUrl).replace('memory://', ''), body, contentType);
    await admin.post(`/v1/files/${pres.body.fileId}/confirm`).expect(200);
    return pres.body.fileId;
  }

  const smallJpeg = () =>
    sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 40, g: 140, b: 90 } } }).jpeg().toBuffer();

  const attach = (fileId: string, extra: Record<string, unknown> = {}) =>
    admin.post(`/v1/listings/${listingId}/photos`).send({ fileId, ...extra });

  /** A photo row without the job (ready or processing). */
  async function seedRow(listingId: string, ready: boolean, alt = 'Bed') {
    const fileId = newId();
    const photoId = newId();
    await m.query(
      `insert into file(id, org_id, key, kind, content_type, size_bytes, confirmed)
       values ($1,$2,$3,'listing_photo','image/jpeg',100,true)`,
      [fileId, orgId, `org/${orgId}/listing_photo/${fileId}.jpg`],
    );
    await m.query(
      `insert into listing_photo(id, org_id, listing_id, file_id, alt, category, width, height, variants, variants_ready, sort_order)
       values ($1,$2,$3,$4,$5,'Bedrooms',$6,$7,$8,$9,(select count(*) from listing_photo where listing_id=$2::text))`,
      [photoId, orgId, listingId, fileId, alt, ready ? 800 : null, ready ? 600 : null, ready ? [480, 800] : [], ready],
    );
    return photoId;
  }

  it('presign refuses a HEIC with the plain-English copy', async () => {
    const r = await admin
      .post('/v1/files/presign')
      .send({ kind: 'listing_photo', contentType: 'image/heic', sizeBytes: 4_000_000 })
      .expect(400);
    expect(JSON.stringify(r.body)).toContain('Use a JPEG, PNG or WebP photo.');
  });

  it('attach needs a confirmed listing_photo file', async () => {
    const pres = await admin
      .post('/v1/files/presign')
      .send({ kind: 'listing_photo', contentType: 'image/jpeg', sizeBytes: 1000 })
      .expect(201);
    const r = await attach(pres.body.fileId).expect(400);
    expect(r.body.error.message).toBe('File not uploaded');
  });

  it('the 61st photo is refused with TOO_MANY_PHOTOS', async () => {
    const jpeg = await smallJpeg();
    for (let i = 0; i < 60; i++) {
      const fid = await uploadOriginal(jpeg);
      await attach(fid).expect(201);
    }
    const last = await uploadOriginal(jpeg);
    const r = await attach(last).expect(422);
    expect(r.body.error.code).toBe('TOO_MANY_PHOTOS');
  });

  it('the first photo becomes the cover when none is set', async () => {
    const fid = await uploadOriginal(await smallJpeg());
    const photo = (await attach(fid).expect(201)).body;
    const l = await admin.get(`/v1/listings/${listingId}`).expect(200);
    expect(l.body.coverPhotoId).toBe(photo.id);
  });

  it('the job turns an original into variants and flips the photo ready', async () => {
    const fid = await uploadOriginal(await smallJpeg());
    const photo = (await attach(fid).expect(201)).body as { id: string; ready: boolean; previewUrl: string | null };
    expect(photo.ready).toBe(false);
    expect(photo.previewUrl).toBe(null);

    const before = await version();
    await job().run();
    expect(await version()).toBe(before + 1);

    const row = (await m.query('select width, height, variants, variants_ready, attempts from listing_photo where id=$1', [photo.id]))
      .rows[0];
    expect(row).toEqual({ width: 800, height: 600, variants: [480, 800], variants_ready: true, attempts: 1 });
    const variant = await media().get(`org/${orgId}/listing/${photo.id}-480.webp`);
    expect(variant).not.toBeNull();
    expect((await sharp(variant!).metadata()).width).toBe(480);

    const got = await admin.get(`/v1/listings/${listingId}`).expect(200);
    expect(got.body.photos[0]).toMatchObject({
      ready: true,
      failed: false,
      previewUrl: `https://media.boogbe.test/org/${orgId}/listing/${photo.id}-480.webp`,
    });
  });

  it('a corrupt original fails three times then shows failed, and never bumps', async () => {
    const bad = await uploadOriginal(Buffer.from('not a jpeg at all'));
    const photo = (await attach(bad).expect(201)).body as { id: string };
    const before = await version();
    for (let i = 0; i < 3; i++) await job().run();
    const row = (await m.query('select attempts, variants_ready, last_error from listing_photo where id=$1', [photo.id])).rows[0];
    expect({ ...row, attempts: Number(row.attempts) }).toEqual({ attempts: 3, variants_ready: false, last_error: expect.any(String) });
    // A fourth tick must not pick it up again (attempts >= 3 leaves the queue).
    await job().run();
    expect((await m.query('select attempts from listing_photo where id=$1', [photo.id])).rows[0].attempts).toBe(3);
    const got = await admin.get(`/v1/listings/${listingId}`).expect(200);
    expect(got.body.photos[0].failed).toBe(true);
    expect(await version()).toBe(before); // the attach bumped; the failed processing does not
  });

  it('ordering, cover and delete each bump once; delete clears a dangling cover', async () => {
    const p1 = await seedRow(listingId, true, 'One');
    const p2 = await seedRow(listingId, true, 'Two');
    const p3 = await seedRow(listingId, true, 'Three');

    let v = await version();
    await admin.put(`/v1/listings/${listingId}/photos/order`).send({ ids: [p3, p1, p2] }).expect(200);
    expect(await version()).toBe(v + 1);
    v = await version();
    let l = await admin.get(`/v1/listings/${listingId}`).expect(200);
    expect(l.body.photos.map((p: { alt: string }) => p.alt)).toEqual(['Three', 'One', 'Two']);

    await admin.put(`/v1/listings/${listingId}/cover`).send({ photoId: p2 }).expect(200);
    expect(await version()).toBe(v + 1);
    v = await version();
    l = await admin.get(`/v1/listings/${listingId}`).expect(200);
    expect(l.body.coverPhotoId).toBe(p2);

    await admin.delete(`/v1/listings/${listingId}/photos/${p2}`).expect(200);
    expect(await version()).toBe(v + 1);
    l = await admin.get(`/v1/listings/${listingId}`).expect(200);
    expect(l.body.coverPhotoId).toBe(null);
    expect(l.body.photos).toHaveLength(2);

    // cover refuses a still-processing photo
    const pending = await seedRow(listingId, false, 'Processing');
    const r = await admin.put(`/v1/listings/${listingId}/cover`).send({ photoId: pending }).expect(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('patch sets alt and category, and bumps once', async () => {
    const p1 = await seedRow(listingId, true, 'Old alt');
    const v = await version();
    const r = await admin
      .patch(`/v1/listings/${listingId}/photos/${p1}`)
      .send({ alt: 'The master bedroom', category: 'Living spaces' })
      .expect(200);
    expect(r.body).toMatchObject({ alt: 'The master bedroom', category: 'Living spaces' });
    expect(await version()).toBe(v + 1);
  });
});
