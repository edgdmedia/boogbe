import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Listing, ListingPhoto } from '@boogbe/shared';
import { PhotoManager } from './PhotoManager';

const photo = (over: Partial<ListingPhoto> = {}): ListingPhoto => ({
  id: 'ph1',
  alt: 'Bedroom',
  category: 'Bedrooms',
  width: 800,
  height: 600,
  sortOrder: 0,
  ready: true,
  failed: false,
  previewUrl: 'https://media.boogbe.test/org/o/listing/ph1-480.webp',
  ...over,
});

const state: { listing: Listing; mutate: ReturnType<typeof vi.fn> } = {
  listing: { id: 'l1' } as Listing,
  mutate: vi.fn(),
};

vi.mock('./hooks', () => ({
  useListing: () => ({ data: state.listing, mutate: state.mutate }),
}));
vi.mock('../../lib/use-me', () => ({
  useMe: () => ({ me: { activeOrg: { role: 'admin', timezone: 'Africa/Lagos' } } }),
}));

function manager(listingOver: Partial<Listing> = {}, photos: ListingPhoto[] = []) {
  state.listing = { ...state.listing, coverPhotoId: 'ph1', photos, ...listingOver } as Listing;
  return render(<PhotoManager listingId="l1" />);
}

function routeFetch(calls: string[], photoSeq = 1) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${String(url)}`);
    if (String(url).endsWith('/presign'))
      return new Response(JSON.stringify({ fileId: `f${photoSeq}`, uploadUrl: 'https://r2/upload', headers: {} }), { status: 201 });
    if (String(url).endsWith('/photos'))
      return new Response(JSON.stringify(photo({ id: `new${photoSeq++}`, alt: '', ready: false, previewUrl: null })), { status: 201 });
    if (String(url).endsWith('/cover') || String(url).includes('/confirm')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (method === 'PATCH') return new Response(JSON.stringify(photo()), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

describe('photo manager', () => {
  beforeEach(() => {
    state.mutate = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uploading 2 files runs presign → PUT → confirm → attach, in order, per file', async () => {
    const calls: string[] = [];
    routeFetch(calls);
    manager();
    const files = [
      new File(['a'], 'one.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'two.png', { type: 'image/png' }),
    ];
    // The file input is hidden behind the Upload button; set it directly.
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => expect(state.mutate).toHaveBeenCalled());
    expect(calls.slice(0, 8)).toEqual([
      'POST /v1/files/presign',
      'PUT https://r2/upload',
      'POST /v1/files/f1/confirm',
      'POST /v1/listings/l1/photos',
      'POST /v1/files/presign',
      'PUT https://r2/upload',
      'POST /v1/files/f2/confirm',
      'POST /v1/listings/l1/photos',
    ]);
  });

  it('refuses a HEIC file with the server copy and makes no network call', async () => {
    const calls: string[] = [];
    routeFetch(calls);
    manager();
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'IMG.HEIC', { type: 'image/heic' })] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(await screen.findByText('Use a JPEG, PNG or WebP photo.')).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('a processing photo shows “Processing…” and refetches until it settles', async () => {
    vi.useFakeTimers();
    manager({}, [photo({ ready: false, previewUrl: null, alt: '' })]);
    expect(screen.getByText('Processing…')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(state.mutate).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('a failed photo shows the failure copy', () => {
    manager({}, [photo({ ready: false, failed: true, previewUrl: null })]);
    expect(screen.getByText(/Couldn.t process this photo/)).toBeInTheDocument();
  });

  it('Set as cover calls PUT /cover', async () => {
    const calls: string[] = [];
    routeFetch(calls);
    manager({ coverPhotoId: 'ph1' }, [photo(), photo({ id: 'ph2', alt: 'Kitchen' })]);
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /set as cover/i })[1] ?? screen.getByRole('button', { name: /set as cover/i }));
    await waitFor(() => expect(calls).toContain('PUT /v1/listings/l1/cover'));
  });

  it('a new photo shows Needs description and typing one PATCHes the photo', async () => {
    const calls: [string, RequestInit?][] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      calls.push([String(url), init]);
      return new Response(JSON.stringify(photo({ alt: 'The master bedroom' })), { status: 200 });
    });
    manager({ coverPhotoId: null }, [photo({ alt: '', ready: true, previewUrl: 'https://x/480.webp' })]);
    expect(screen.getByText('Needs description')).toBeInTheDocument();
    const user = userEvent.setup();
    const box = screen.getByLabelText('Photo description');
    await user.type(box, 'The master bedroom');
    await user.tab();
    await waitFor(() => expect(calls.some(([u]) => u === '/v1/listings/l1/photos/ph1')).toBe(true));
    expect(JSON.parse(String(calls.find(([u]) => u === '/v1/listings/l1/photos/ph1')?.[1]?.body))).toEqual({ alt: 'The master bedroom' });
  });

  it('delete calls DELETE on the photo route', async () => {
    const calls: string[] = [];
    routeFetch(calls);
    manager({}, [photo()]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /delete photo/i }));
    await waitFor(() => expect(calls).toContain('DELETE /v1/listings/l1/photos/ph1'));
  });
});
