import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';
import { STORAGE } from '../src/common/files/storage';
import type { MemoryStorage } from '../src/common/files/storage';

async function seedSettings(orgId: string) {
  const m = await migratorClient();
  await m.query(
    `insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'TAN','TAN','TAN',now())`,
    [orgId],
  );
  await m.end();
}

describe('files [ORG-01]', () => {
  let t: TestApp;
  let storage: MemoryStorage;
  beforeAll(async () => {
    t = await createTestApp();
    storage = t.app.get(STORAGE);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll();
    storage.objects.clear();
  });

  it('admin uploads a logo and settings return a signed url', async () => {
    const org = await seedOrg();
    await seedSettings(org.id);
    const { agent } = await signInAs(t, 'admin', org.id);
    const p = await agent
      .post('/v1/files/presign')
      .send({ kind: 'logo', contentType: 'image/png', sizeBytes: 1000 })
      .expect(201);
    expect(p.body.uploadUrl).toMatch(/^memory:\/\/org\//);
    await agent.post(`/v1/files/${p.body.fileId}/confirm`).expect(400); // not uploaded yet
    storage.objects.set(p.body.uploadUrl.replace('memory://', ''), {
      body: Buffer.alloc(1000),
      contentType: 'image/png',
    });
    await agent.post(`/v1/files/${p.body.fileId}/confirm`).expect(200);
    await agent.patch('/v1/org/settings').send({ logoFileId: p.body.fileId }).expect(200);
    const s = await agent.get('/v1/org/settings').expect(200);
    expect(s.body.settings.logoUrl).toMatch(/^memory:\/\/get\/org\//);
  });

  it('rejects wrong types, oversize files and generated kinds', async () => {
    const org = await seedOrg();
    await seedSettings(org.id);
    const { agent } = await signInAs(t, 'admin', org.id);
    await agent
      .post('/v1/files/presign')
      .send({ kind: 'logo', contentType: 'image/gif', sizeBytes: 10 })
      .expect(400);
    await agent
      .post('/v1/files/presign')
      .send({ kind: 'logo', contentType: 'image/png', sizeBytes: 3 * 1024 * 1024 })
      .expect(400);
    await agent
      .post('/v1/files/presign')
      .send({ kind: 'statement_pdf', contentType: 'application/pdf', sizeBytes: 10 })
      .expect(400);
  });

  it('frontdesk cannot upload a logo; housekeeper can upload task photos', async () => {
    const org = await seedOrg();
    await seedSettings(org.id);
    const fd = await signInAs(t, 'frontdesk', org.id);
    await fd.agent
      .post('/v1/files/presign')
      .send({ kind: 'logo', contentType: 'image/png', sizeBytes: 10 })
      .expect(403);
    const hk = await signInAs(t, 'housekeeper', org.id);
    await hk.agent
      .post('/v1/files/presign')
      .send({ kind: 'task_photo', contentType: 'image/jpeg', sizeBytes: 10 })
      .expect(201);
  });

  it('confirm rejects an object larger than declared limit', async () => {
    const org = await seedOrg();
    await seedSettings(org.id);
    const { agent } = await signInAs(t, 'admin', org.id);
    const p = await agent
      .post('/v1/files/presign')
      .send({ kind: 'logo', contentType: 'image/png', sizeBytes: 1000 })
      .expect(201);
    storage.objects.set(p.body.uploadUrl.replace('memory://', ''), {
      body: Buffer.alloc(3 * 1024 * 1024),
      contentType: 'image/png',
    });
    await agent.post(`/v1/files/${p.body.fileId}/confirm`).expect(400);
  });

  it('members of a suspended operator cannot upload [PLT-03]', async () => {
    const org = await seedOrg();
    await seedSettings(org.id);
    const { agent } = await signInAs(t, 'admin', org.id);
    const m = await migratorClient();
    await m.query(`update organization set status='suspended' where id=$1`, [org.id]);
    await m.end();
    const r = await agent
      .post('/v1/files/presign')
      .send({ kind: 'logo', contentType: 'image/png', sizeBytes: 10 });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('ORG_SUSPENDED');
  });
});
