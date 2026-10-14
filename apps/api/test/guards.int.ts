import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, seedUser, signIn, signInAs } from './helpers/users';

describe('guards', () => {
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

  it('public route needs no session', async () => {
    await t.http.get('/v1/health').expect(200);
  });

  it('signed-in route rejects anonymous with 401', async () => {
    const res = await t.http.get('/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('me returns memberships and active org with role from the database [AUTH-05 AUTH-06]', async () => {
    const org = await seedOrg('Tanuhomes');
    const { agent } = await signInAs(t, 'frontdesk', org.id);
    const res = await agent.get('/v1/me').expect(200);
    expect(res.body.activeOrg).toMatchObject({
      id: org.id,
      name: 'Tanuhomes',
      role: 'frontdesk',
      timezone: 'Africa/Lagos',
    });
    expect(res.body.memberships).toEqual([{ orgId: org.id, orgName: 'Tanuhomes', role: 'frontdesk' }]);
  });

  it('role change takes effect on the next request without re-login [AUTH-06]', async () => {
    const org = await seedOrg();
    const { agent, memberId } = await signInAs(t, 'frontdesk', org.id);
    const c = await migratorClient();
    await c.query(`update member set role='housekeeper' where id=$1`, [memberId]);
    await c.end();
    const res = await agent.get('/v1/me').expect(200);
    expect(res.body.activeOrg.role).toBe('housekeeper');
  });

  it('removed member loses org access immediately [AUTH-06]', async () => {
    const org = await seedOrg();
    const { agent, memberId } = await signInAs(t, 'admin', org.id);
    const c = await migratorClient();
    await c.query(`delete from member where id=$1`, [memberId]);
    await c.end();
    const res = await agent.get('/v1/me').expect(200);
    expect(res.body.activeOrg).toBeNull();
  });

  it('suspended org is refused [PLT-03]', async () => {
    const org = await seedOrg();
    const { agent } = await signInAs(t, 'admin', org.id);
    const c = await migratorClient();
    await c.query(`update organization set status='suspended' where id=$1`, [org.id]);
    await c.end();
    const res = await agent.get('/v1/org/settings');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORG_SUSPENDED');
  });

  it('platform routes refuse non-platform users [PLT-04]', async () => {
    const u = await seedUser(t);
    const agent = await signIn(t, u.email, u.password);
    expect((await agent.get('/v1/platform/operators')).status).toBe(403);
  });
});
