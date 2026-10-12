import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';
import { OrgDb } from '../src/common/db/org-db.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

describe('notifications [NTF-01]', () => {
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

  it('notifies admins only, dedupes, marks read', async () => {
    const orgId = (await seedOrg()).id;
    const admin = await signInAs(t, 'admin', orgId);
    const fd = await signInAs(t, 'frontdesk', orgId);
    const svc = t.app.get(NotificationsService);
    const db = t.app.get(OrgDb);
    const n = { kind: 'ical_feed_failing' as const, title: 'Feed failing', dedupeKey: 'feed-1' };
    await db.run(orgId, (tx) => svc.notifyRoles(tx, orgId, ['admin'], n));
    await db.run(orgId, (tx) => svc.notifyRoles(tx, orgId, ['admin'], n));
    const a = (await admin.agent.get('/v1/notifications').expect(200)).body;
    expect(a.unreadCount).toBe(1);
    expect((await fd.agent.get('/v1/notifications').expect(200)).body.unreadCount).toBe(0);
    await admin.agent.post(`/v1/notifications/${a.items[0].id}/read`).expect(200);
    expect((await admin.agent.get('/v1/notifications').expect(200)).body.unreadCount).toBe(0);
  });
});
