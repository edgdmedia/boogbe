import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Listing } from '@boogbe/shared';
import { ListingEditor } from './ListingEditor';

const listing = (over: Partial<Listing> = {}): Listing => ({
  id: 'l1',
  name: 'Destiny',
  slug: 'destiny',
  area: 'Ikate',
  highlight: null,
  intro: 'A calm two-bedroom.',
  description: 'Sea breeze.',
  amenities: [],
  houseRules: [],
  bathroomsLabel: null,
  layoutLabel: null,
  seoTitle: null,
  seoDescription: null,
  published: false,
  publishedAt: null,
  coverPhotoId: null,
  sortOrder: 0,
  updatedAt: '2026-10-20T10:00:00.000Z',
  units: [{ id: 'u1', name: 'Destiny 1', label: '1 bedroom', nightlyRateKobo: 17_500_000, maxGuests: 2, bookable: true }],
  photos: [],
  ...over,
});

const state: { current: Listing } = { current: listing() };
const me = { role: 'admin' as 'admin' | 'frontdesk' };
const mutate = vi.fn();
vi.mock('./hooks', () => ({
  useListing: () => ({ data: state.current, mutate }),
  useOrgSettings: () => ({ data: { org: {}, settings: { publicSiteUrl: 'https://tanuhomes.com' } } }),
}));
vi.mock('../inventory/hooks', () => ({
  useUnits: () => ({ data: { items: [{ id: 'u1', propertyId: 'p1', name: 'Destiny 1', bedrooms: 1, maxGuests: 2, nightlyRateKobo: 17_500_000, active: true, publicListed: true }] }, mutate: vi.fn() }),
  useProperties: () => ({ data: { items: [{ id: 'p1', name: 'The Rock' }] }, mutate: vi.fn() }),
}));
vi.mock('../../lib/use-me', () => ({
  useMe: () => ({ me: { activeOrg: { role: me.role, timezone: 'Africa/Lagos' } } }),
}));

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/website/listings/l1']}>
      <Routes>
        <Route path="/website/listings/:id" element={<ListingEditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('listing editor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    state.current = listing();
    me.role = 'admin';
  });

  it('sends the change with expectedUpdatedAt and reports the save', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(listing({ intro: 'Rewritten.' }))));
    renderEditor();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Intro'));
    await user.type(screen.getByLabelText('Intro'), 'Rewritten.');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/v1/listings/l1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toMatchObject({ intro: 'Rewritten.', expectedUpdatedAt: '2026-10-20T10:00:00.000Z' });
    expect(await screen.findByText('Saved. Live on your website within a minute.')).toBeInTheDocument();
    expect(mutate).toHaveBeenCalled();
  });

  it('a STALE save shows the reload banner with who changed it', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ error: { code: 'STALE', message: 'no', details: { updatedAt: '2026-10-20T10:41:00.000Z', updatedBy: 'Ada' } } }),
          { status: 409 },
        ),
    );
    renderEditor();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Intro'));
    await user.type(screen.getByLabelText('Intro'), 'Mine first.');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('Someone else updated this listing at');
    expect(banner.textContent).toContain('Reload to see their changes.');
  });

  it('an empty draft lists all seven blockers and Publish stays disabled', () => {
    state.current = listing({
      name: '',
      area: null,
      intro: null,
      description: null,
      coverPhotoId: null,
      units: [],
      photos: [],
    });
    renderEditor();
    for (const text of [
      'Add a name',
      'Add an intro',
      'Add a description',
      'Add at least 3 photos',
      'Every photo needs a description',
      'Choose a cover photo',
      'Link at least one unit',
    ])
      expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /publish/i })).toBeDisabled();
  });

  it('changing the slug on a published listing warns about the redirect', async () => {
    state.current = listing({ published: true, publishedAt: '2026-10-20T09:00:00.000Z' });
    renderEditor();
    expect(screen.queryByText('The old address will redirect to the new one.')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Address ending (slug)'));
    await user.type(screen.getByLabelText('Address ending (slug)'), 'destiny-ph');
    expect(await screen.findByText('The old address will redirect to the new one.')).toBeInTheDocument();
  });

  it('front desk sees no edit controls', () => {
    me.role = 'frontdesk';
    renderEditor();
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeDisabled();
  });

  it('the units field lists active units grouped, keeps the selection, and PUTs it on save', async () => {
    state.current = listing({ units: [] });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) => new Response(JSON.stringify(url === '/v1/listings/l1/units' ? listing() : listing({ units: [] }))));
    renderEditor();
    const user = userEvent.setup();
    expect(await screen.findByText('The Rock')).toBeInTheDocument(); // grouped by property
    const box = screen.getByRole('checkbox', { name: /Destiny 1/ });
    expect(box).not.toBeChecked();
    await user.click(box);
    await user.type(screen.getByLabelText('Website label for Destiny 1'), '1 bedroom');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/v1/listings/l1/units', expect.objectContaining({ method: 'PUT' })));
    const put = fetchMock.mock.calls.find((c) => c[0] === '/v1/listings/l1/units') as [string, RequestInit];
    expect(JSON.parse(String(put[1].body))).toEqual([{ unitId: 'u1', label: '1 bedroom' }]);
  });
});
