import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://boogbe_app:app@localhost:5433/boogbe_dev',
  BETTER_AUTH_URL: 'https://app.boogbe.com',
  APP_ORIGIN: 'https://app.boogbe.com',
  BETTER_AUTH_SECRET: 'change-me-32-chars-minimum-xxxxxxxx',
};

describe('loadEnv', () => {
  it('refuses the .env.example placeholder secret in production [NFR-04]', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow('BETTER_AUTH_SECRET');
  });
  it('allows the placeholder secret in development', () => {
    expect(loadEnv({ ...base, NODE_ENV: 'development' }).BETTER_AUTH_SECRET).toBe(base.BETTER_AUTH_SECRET);
  });
});
