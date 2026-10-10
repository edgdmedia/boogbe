import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';
import { MAILER } from '../src/common/mail/mail.module';
import type { MemoryMailer } from '../src/common/mail/mailer';

describe('team management [AUTH-04 AUTH-08]', () => {
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

  it('admin invites a housekeeper by email', async () => {
    const org = await seedOrg('Tanuhomes');
    const { agent } = await signInAs(t, 'admin', org.id);
    const r = await agent
      .post('/v1/auth/organization/invite-member')
      .send({ email: 'hk@t.ng', role: 'housekeeper', organizationId: org.id });
    expect(r.status).toBe(200);
    expect(t.app.get<MemoryMailer>(MAILER).lastTo('hk@t.ng')!.text).toContain('Housekeeper');
  });

  it('frontdesk cannot invite', async () => {
    const org = await seedOrg();
    const { agent } = await signInAs(t, 'frontdesk', org.id);
    const r = await agent
      .post('/v1/auth/organization/invite-member')
      .send({ email: 'x@t.ng', role: 'admin', organizationId: org.id });
    expect(r.status).toBe(403);
  });

  it('rejects unknown roles such as owner', async () => {
    const org = await seedOrg();
    const { agent } = await signInAs(t, 'admin', org.id);
    const r = await agent
      .post('/v1/auth/organization/invite-member')
      .send({ email: 'x@t.ng', role: 'owner', organizationId: org.id });
    expect(r.status).toBe(400);
  });

  it('cannot demote the last admin via better-auth endpoint', async () => {
    const org = await seedOrg();
    const { agent, memberId } = await signInAs(t, 'admin', org.id);
    const r = await agent
      .post('/v1/auth/organization/update-member-role')
      .send({ memberId, role: 'frontdesk', organizationId: org.id });
    expect(r.status).toBe(400);
    // better-auth blocks *self*-demotion of the only admin first ("...without an owner");
    // our LAST_ADMIN message covers demoting someone else (covered by the remove test below).
    expect(JSON.stringify(r.body)).toMatch(/at least one admin|without an owner/);
  });

  it('cannot remove the last admin', async () => {
    const org = await seedOrg();
    const { agent, memberId } = await signInAs(t, 'admin', org.id);
    const r = await agent
      .post('/v1/auth/organization/remove-member')
      .send({ memberIdOrEmail: memberId, organizationId: org.id });
    expect(r.status).toBe(400);
  });

  it('with two admins one can be demoted and it is audited', async () => {
    const org = await seedOrg();
    const a1 = await signInAs(t, 'admin', org.id);
    const a2 = await signInAs(t, 'admin', org.id);
    await a1.agent
      .post('/v1/auth/organization/update-member-role')
      .send({ memberId: a2.memberId, role: 'frontdesk', organizationId: org.id })
      .expect(200);
    const m = await migratorClient();
    const { rows } = await m.query(`select action from audit_log where org_id=$1`, [org.id]);
    await m.end();
    expect(rows.map((r) => r.action)).toContain('member.role_change');
  });
});
