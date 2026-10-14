import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import supertest from 'supertest';
import { buildApp } from '../src/build-app';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, seedUser, signInAs } from './helpers/users';

function setCookies(res: supertest.Response): string[] {
  return (res.headers['set-cookie'] ?? []) as unknown as string[];
}

describe('cookie & CSRF hardening [NFR-02 AUTH-01]', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('session cookie is HttpOnly and SameSite in the default environment', async () => {
    const u = await seedUser(t);
    const res = await t.http.post('/v1/auth/sign-in/email').set('Origin', 'http://localhost:5173').send({ email: u.email, password: u.password });
    expect(res.status).toBe(200);
    const cookies = setCookies(res).filter((c) => /session/i.test(c));
    expect(cookies.length).toBeGreaterThan(0);
    for (const c of cookies) {
      expect(c.toLowerCase()).toContain('httponly');
      expect(/samesite=(lax|strict)/.test(c.toLowerCase())).toBe(true);
    }
  });

  it('production: session cookie carries the __Secure- prefix and the Secure attribute', async () => {
    const u = await seedUser(t);
    const saved = { ...process.env };
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(40);
    process.env.BETTER_AUTH_URL = 'https://api.boogbe.com';
    process.env.APP_ORIGIN = 'https://app.boogbe.com';
    process.env.API_PUBLIC_ORIGIN = 'https://api.boogbe.com';
    // #22 requires R2_* in production; dummy values — nothing touches the network here.
    process.env.R2_ENDPOINT = 'https://r2.invalid';
    process.env.R2_BUCKET = 'boogbe-test';
    process.env.R2_ACCESS_KEY_ID = 'dummy';
    process.env.R2_SECRET_ACCESS_KEY = 'dummy';
    let prod: NestExpressApplication | undefined;
    try {
      prod = await buildApp();
      await prod.init();
      const http = supertest(prod.getHttpServer());
      const res = await http.post('/v1/auth/sign-in/email').set('Origin', 'https://app.boogbe.com').send({
        email: u.email,
        password: u.password,
      });
      expect(res.status).toBe(200);
      const cookies = setCookies(res).filter((c) => /session/i.test(c));
      expect(cookies.length).toBeGreaterThan(0);
      for (const c of cookies) {
        const low = c.toLowerCase();
        expect(low).toContain('secure');
        expect(low).toContain('httponly');
        expect(/samesite=(lax|strict)/.test(low)).toBe(true);
      }
      expect(cookies.some((c) => c.startsWith('__Secure-'))).toBe(true);
    } finally {
      await prod?.close();
      for (const k of ['NODE_ENV', 'DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'APP_ORIGIN', 'API_PUBLIC_ORIGIN', 'R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });

  describe('content-type gate on state-changing /v1 routes', () => {
    let member: Awaited<ReturnType<typeof signInAs>>;
    beforeAll(async () => {
      await truncateAll();
      const org = await seedOrg('Tanuhomes');
      member = await signInAs(t, 'admin', org.id);
      const m = await migratorClient();
      await m.query(
        `insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'TAN','TAN','TAN',now())`,
        [org.id],
      );
      await m.end();
    });

    it('form-encoded PATCH to org settings → 415, nothing changes', async () => {
      const res = await member.agent
        .patch('/v1/org/settings')
        .set('content-type', 'application/x-www-form-urlencoded')
        .send('checkInTime=15:00');
      expect(res.status).toBe(415);
      expect(res.body.error?.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      const s = await member.agent.get('/v1/org/settings');
      expect(s.body.settings.checkInTime).toBe('14:00');
    });

    it('text/plain POST to platform operators → 415 even before authz', async () => {
      const res = await t.http
        .post('/v1/platform/operators')
        .set('content-type', 'text/plain')
        .send('{"name":"evil","slug":"evil"}');
      expect(res.status).toBe(415);
    });

    it('missing content-type (no body) is still allowed through', async () => {
      const op = (await member.agent // not a platform admin → 403 proves it reached authorization, not 415
        .post('/v1/platform/operators/00000000-0000-0000-0000-000000000000/suspend')
        .send());
      expect(op.status).toBe(403);
    });

    it('multipart (file-style form) POST → 415', async () => {
      const res = await member.agent
        .post('/v1/org/settings')
        .set('content-type', 'multipart/form-data; boundary=x')
        .send('--x\r\nContent-Disposition: form-data; name="checkInTime"\r\n\r\n15:00\r\n--x--\r\n');
      expect(res.status).toBe(415);
    });

    it('JSON content type keeps working', async () => {
      const res = await member.agent.patch('/v1/org/settings').send({ checkInTime: '15:00' });
      expect(res.status).toBe(200);
    });

    it('the auth endpoints are NOT gated (better-auth parses its own body) — form POST is still refused by them', async () => {
      const res = await t.http
        .post('/v1/auth/sign-in/email')
        .set('content-type', 'application/x-www-form-urlencoded')
        .send('email=a@b.c&password=x');
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});
