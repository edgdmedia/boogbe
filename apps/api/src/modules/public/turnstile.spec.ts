import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudflareTurnstile, isTestSecret } from './turnstile';
import { loadEnv } from '../../env';

const reply = (body: unknown) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body)));

describe('CloudflareTurnstile', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fails closed without a secret, without calling Cloudflare', async () => {
    const f = reply({ success: true });
    expect(await new CloudflareTurnstile(undefined).verify('t', '1.2.3.4')).toEqual({ success: false });
    expect(f).not.toHaveBeenCalled();
  });

  it('returns the hostname the challenge was solved on', async () => {
    reply({ success: true, hostname: 'tanuhomes.com' });
    expect(await new CloudflareTurnstile('0x-real-secret').verify('t', undefined)).toEqual({ success: true, hostname: 'tanuhomes.com' });
  });

  it("Cloudflare's dummy test secrets skip the hostname check (local and staging)", async () => {
    reply({ success: true, hostname: 'example.com' });
    expect(await new CloudflareTurnstile('1x0000000000000000000000000000000AA').verify('XXXX.DUMMY.TOKEN.XXXX', undefined)).toEqual({
      success: true,
      hostname: 'example.com',
      testKey: true,
    });
    expect(isTestSecret('2x0000000000000000000000000000000AA')).toBe(true);
    expect(isTestSecret('0x4AAAAAAAreal')).toBe(false);
  });

  it('a network failure is a failed verification', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await new CloudflareTurnstile('0x-real-secret').verify('t', undefined)).toEqual({ success: false });
  });

  it('production refuses a dummy test secret', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x@y/z',
      BETTER_AUTH_SECRET: 'a'.repeat(40),
      BETTER_AUTH_URL: 'https://api.boogbe.com',
      APP_ORIGIN: 'https://app.boogbe.com',
      API_PUBLIC_ORIGIN: 'https://api.boogbe.com',
      R2_ENDPOINT: 'https://r2.example.com',
      R2_BUCKET: 'b',
      R2_ACCESS_KEY_ID: 'k',
      R2_SECRET_ACCESS_KEY: 's',
    };
    expect(() => loadEnv({ ...base, TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' } as never)).toThrow(/TURNSTILE_SECRET_KEY/);
    expect(() => loadEnv({ ...base, TURNSTILE_SECRET_KEY: '0x4AAAAAAAreal' } as never)).not.toThrow();
  });
});
