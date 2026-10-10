import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll, migratorClient } from './helpers/db';
import { seedUser, signIn, seedInvitation } from './helpers/users';
import { MAILER } from '../src/common/mail/mail.module';
import type { MemoryMailer } from '../src/common/mail/mailer';

describe('auth', () => {
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

  it('sign-up without invitation is rejected [AUTH-01]', async () => {
    const res = await t
      .agent()
      .post('/v1/auth/sign-up/email')
      .send({ email: 'uninvited@test.boogbe', password: 'correct-horse-battery', name: 'X' });
    expect(res.status).toBe(403);
    const c = await migratorClient();
    const { rows } = await c.query(`select count(*)::int as n from "user"`);
    await c.end();
    expect(rows[0].n).toBe(0);
  });

  it('invited user can sign in and get a session [AUTH-01]', async () => {
    const u = await seedUser(t);
    const agent = await signIn(t, u.email, u.password);
    const s = await agent.get('/v1/auth/get-session');
    expect(s.status).toBe(200);
    expect(s.body.user.email).toBe(u.email);
  });

  it('wrong password returns a generic error [AUTH-01]', async () => {
    const u = await seedUser(t);
    const res = await t.agent().post('/v1/auth/sign-in/email').send({ email: u.email, password: 'wrong-password-123' });
    expect(res.status).toBe(401);
    const res2 = await t
      .agent()
      .post('/v1/auth/sign-in/email')
      .send({ email: 'nobody@test.boogbe', password: 'wrong-password-123' });
    expect(res2.status).toBe(401);
    expect(res2.body.message).toBe(res.body.message);
  });

  it('locks the account after 5 failures, even with the right password [AUTH-02]', async () => {
    const u = await seedUser(t);
    for (let i = 0; i < 5; i++) {
      await t.agent().post('/v1/auth/sign-in/email').send({ email: u.email, password: 'wrong-password-123' });
    }
    const res = await t.agent().post('/v1/auth/sign-in/email').send({ email: u.email, password: u.password });
    expect(res.status).toBe(429);
  });

  it('password reset emails a link and revokes other sessions [AUTH-03]', async () => {
    const u = await seedUser(t);
    const other = await signIn(t, u.email, u.password);
    await t
      .agent()
      .post('/v1/auth/request-password-reset')
      .send({ email: u.email, redirectTo: 'http://localhost:5173/auth/reset' })
      .expect(200);
    const mail = t.app.get<MemoryMailer>(MAILER).lastTo(u.email)!;
    const token = /reset-password\/([A-Za-z0-9_-]+)/.exec(mail.text)![1];
    await t.agent().post('/v1/auth/reset-password').send({ newPassword: 'brand-new-password-1', token }).expect(200);
    const s = await other.get('/v1/auth/get-session');
    expect(s.body).toBeNull();
    await signIn(t, u.email, 'brand-new-password-1');
  });

  it('rejects passwords shorter than 10 characters [AUTH-01]', async () => {
    const inv = await seedInvitation('short@test.boogbe');
    const res = await t
      .agent()
      .post('/v1/auth/sign-up/email')
      .send({ email: 'short@test.boogbe', password: 'short', name: 'S', invitationId: inv });
    expect(res.status).toBe(400);
  });
});
