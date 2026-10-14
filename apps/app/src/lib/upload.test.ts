import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadFile } from './upload';

afterEach(() => vi.restoreAllMocks());

describe('uploadFile', () => {
  it('rejects oversize files before calling the API', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    const big = new File([new Uint8Array(3 * 1024 * 1024)], 'logo.png', { type: 'image/png' });
    await expect(uploadFile('logo', big)).rejects.toThrow('Max 2048 KB');
    expect(f).not.toHaveBeenCalled();
  });
  it('presigns, uploads and confirms', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      if (String(url).endsWith('/presign'))
        return new Response(
          JSON.stringify({ fileId: 'f1', uploadUrl: 'https://r2/x', headers: { 'content-type': 'image/png' } }),
          { status: 201 },
        );
      return new Response('{}', { status: 200 });
    });
    const id = await uploadFile('logo', new File(['x'], 'logo.png', { type: 'image/png' }));
    expect(id).toBe('f1');
    expect(calls).toEqual(['POST /v1/files/presign', 'PUT https://r2/x', 'POST /v1/files/f1/confirm']);
  });
  it('rejects an unsupported content type client-side', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(uploadFile('logo', new File(['x'], 'logo.gif', { type: 'image/gif' }))).rejects.toThrow(/png|jpeg|webp/);
    expect(spy).not.toHaveBeenCalled();
  });
});
