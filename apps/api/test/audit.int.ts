import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';

describe('audit viewer [AUD-02]', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it('admin sees entries with actor names; frontdesk cannot', async () => {
    const orgId = (await seedOrg()).id;
    const admin = await signInAs(t, 'admin', orgId);
    await admin.agent.post('/v1/owners').send({ name: 'Mrs A' }).expect(201);
    const r = (await admin.agent.get('/v1/audit?entity=owner').expect(200)).body;
    expect(r.items[0]).toMatchObject({ action: 'owner.create', entity: 'owner', actorName: 'Test User' });
    await (await signInAs(t, 'frontdesk', orgId)).agent.get('/v1/audit').expect(403);
  });

  it('lists newest first and pages with a cursor', async () => {
    const orgId = (await seedOrg()).id;
    const admin = await signInAs(t, 'admin', orgId);
    for (const name of ['First', 'Second', 'Third'])
      await admin.agent.post('/v1/owners').send({ name }).expect(201);
    const p1 = (await admin.agent.get('/v1/audit?entity=owner&limit=2').expect(200)).body;
    expect(p1.items.map((i: { after: { name: string } }) => i.after.name)).toEqual(['Third', 'Second']);
    const p2 = (await admin.agent.get(`/v1/audit?entity=owner&limit=2&cursor=${p1.nextCursor}`).expect(200))
      .body;
    expect(p2.items.map((i: { after: { name: string } }) => i.after.name)).toEqual(['First']);
    expect(p2.nextCursor).toBeNull();
  });
});
