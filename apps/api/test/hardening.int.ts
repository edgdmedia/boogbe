import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedInvitation, seedUser } from './helpers/users';

const GENERIC = 'Boogbe is invite-only. Ask your operator for an invitation.';

// Set before the app (and therefore loadEnv) is created in beforeAll.
process.env.PLATFORM_ADMIN_EMAILS = 'pa-hardening@test.boogbe';

describe('auth hardening [AUTH-01 NFR-02]', () => {
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

  it('sign-up for a pending invitation email WITHOUT the invitation id is rejected (no squatting)', async () => {
    const email = 'squattest@test.boogbe';
    await seedInvitation(email);
    const res = await t
      .agent()
      .post('/v1/auth/sign-up/email')
      .send({ email, password: 'correct-horse-battery', name: 'Squatter' });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(GENERIC);
    const c = await migratorClient();
    const { rows } = await c.query(`select count(*)::int n from "user" where email=$1`, [email]);
    await c.end();
    expect(rows[0].n).toBe(0);
  });

  it('sign-up with an invitation id that does not belong to the email is rejected', async () => {
    const e1 = 'one@test.boogbe';
    const e2 = 'two@test.boogbe';
    const inv1 = await seedInvitation(e1);
    await seedInvitation(e2);
    const res = await t
      .agent()
      .post('/v1/auth/sign-up/email')
      .send({ email: e2, password: 'correct-horse-battery', name: 'X', invitationId: inv1 });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(GENERIC);
  });

  it('sign-up WITH the matching invitation id succeeds', async () => {
    const email = 'legit@test.boogbe';
    const invId = await seedInvitation(email);
    const res = await t
      .agent()
      .post('/v1/auth/sign-up/email')
      .send({ email, password: 'correct-horse-battery', name: 'Legit', invitationId: invId });
    expect(res.status).toBe(200);
  });

  it('existing account cannot be probed: identical response for taken and unknown emails without a valid invite', async () => {
    const u = await seedUser(t, { email: 'taken@test.boogbe' });
    const a = await t
      .agent()
      .post('/v1/auth/sign-up/email')
      .send({ email: u.email, password: 'correct-horse-battery', name: 'Probe' });
    const b = await t
      .agent()
      .post('/v1/auth/sign-up/email')
      .send({ email: 'unknown@test.boogbe', password: 'correct-horse-battery', name: 'Probe' });
    expect(a.status).toBe(b.status);
    expect(a.body).toEqual(b.body);
  });

  it('existing account with a valid invitation for the same email still cannot re-sign-up (same generic response)', async () => {
    const u = await seedUser(t, { email: 'again@test.boogbe' });
    const inv = await seedInvitation('again@test.boogbe');
    const res = await t
      .agent()
      .post('/v1/auth/sign-up/email')
      .send({ email: u.email, password: 'correct-horse-battery', name: 'X', invitationId: inv });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(GENERIC);
  });

  it('platform-admin bootstrap emails may sign up without an invitation', async () => {
    const email = 'pa-hardening@test.boogbe';
    const res = await t
      .agent()
      .post('/v1/auth/sign-up/email')
      .send({ email, password: 'correct-horse-battery', name: 'PA', invitationId: '' });
    expect(res.status).toBe(200);
  });

  it('rate limiters see the real client IP from the proxy header (trust proxy)', async () => {
    const direct = await t.agent().get('/v1/__test/ip');
    expect(direct.status).toBe(200);
    expect(direct.body.ip).toMatch(/127\.0\.0\.1|::1/);
    const proxied = await t.agent().get('/v1/__test/ip').set('x-forwarded-for', '203.0.113.7');
    expect(proxied.body.ip).toBe('203.0.113.7');
  });

  it('requests from the wrong website cannot read responses (CORS) and BA rejects untrusted origins on auth', async () => {
    const evil = await t
      .agent()
      .post('/v1/auth/sign-in/email')
      .set('Origin', 'https://evil.example')
      .send({ email: 'attacker@evil.example', password: 'whatever-1234' });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const me = await t.agent().get('/v1/me').set('Origin', 'https://evil.example');
    expect(me.headers['access-control-allow-origin']).toBeUndefined();
    const good = await t.agent().post('/v1/auth/sign-in/email').set('Origin', 'http://localhost:5173').send({ email: 'a@b.c', password: 'x'.repeat(12) });
    expect(good.status).not.toBe(403);
    expect(good.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(good.headers['access-control-allow-credentials']).toBe('true');
  });

  it('short password with a valid invitation is still rejected by validation (400)', async () => {
    const inv = await seedInvitation('shorty@test.boogbe');
    const res = await t.agent().post('/v1/auth/sign-up/email').send({ email: 'shorty@test.boogbe', password: 'short', name: 'S', invitationId: inv });
    expect(res.status).toBe(400);
  });
});
