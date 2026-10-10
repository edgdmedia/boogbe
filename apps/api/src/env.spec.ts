import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDotEnv, loadEnv } from './env';

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

describe('loadDotEnv', () => {
  afterEach(() => {
    delete process.env.BOOGBE_T_FILE_ONLY;
    delete process.env.BOOGBE_T_PRESET;
  });
  it('loads keys from the .env file without overriding ones already set (PM2 env wins)', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'boogbe-env-')), '.env');
    writeFileSync(file, 'BOOGBE_T_FILE_ONLY=from-file\nBOOGBE_T_PRESET=from-file\n');
    process.env.BOOGBE_T_PRESET = 'preset';
    loadDotEnv(file);
    expect(process.env.BOOGBE_T_FILE_ONLY).toBe('from-file');
    expect(process.env.BOOGBE_T_PRESET).toBe('preset');
  });
  it('is a no-op when the file does not exist (CI, containers)', () => {
    expect(() => loadDotEnv('/nonexistent/boogbe/.env')).not.toThrow();
  });
});
