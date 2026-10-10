import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { api, ApiError } from './api';

afterEach(() => vi.restoreAllMocks());

describe('api', () => {
  it('sends credentials and JSON, parses with schema', async () => {
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ n: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    const r = await api('/v1/x', { method: 'POST', body: { a: 1 }, schema: z.object({ n: z.number() }) });
    expect(r).toEqual({ n: 1 });
    expect(f).toHaveBeenCalledWith(
      '/v1/x',
      expect.objectContaining({ method: 'POST', credentials: 'include', body: '{"a":1}' }),
    );
  });
  it('throws ApiError with code from the envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ error: { code: 'DATES_UNAVAILABLE', message: 'Taken' } }), { status: 409 }),
    );
    await expect(api('/v1/x')).rejects.toMatchObject({ code: 'DATES_UNAVAILABLE', status: 409, message: 'Taken' });
    await expect(api('/v1/x')).rejects.toBeInstanceOf(ApiError);
  });
  it('maps network failure to a friendly error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('/v1/x')).rejects.toMatchObject({
      code: 'INTERNAL',
      message: 'Network problem — check your connection and try again.',
    });
  });
});
