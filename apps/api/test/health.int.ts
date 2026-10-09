import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';

describe('health', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('returns ok and a request id', async () => {
    const res = await t.http.get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: true });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('unknown route returns the error envelope', async () => {
    const res = await t.http.get('/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String), requestId: expect.any(String) },
    });
  });
});
