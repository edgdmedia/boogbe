import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Listing } from '@boogbe/shared';
import { ListingsPage } from './ListingsPage';

const unit = { id: 'u1', name: 'Destiny 1', label: '1 bedroom', nightlyRateKobo: 17_500_000, maxGuests: 2, bookable: true };

const listing = (over: Partial<Listing> = {}): Listing => ({
  id: 'l1',
  name: 'Destiny',
  slug: 'destiny',
  area: null,
  highlight: null,
  intro: null,
  description: null,
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
  units: [unit],
  photos: [],
  ...over,
});

const listings = vi.fn();
const me = { role: 'admin' as 'admin' | 'frontdesk' };
vi.mock('./hooks', () => ({
  useListings: () => listings(),
  useOrgSettings: () => ({ data: { org: {}, settings: { publicSiteUrl: 'https://tanuhomes.com' } } }),
}));
vi.mock('../../lib/use-me', () => ({
  useMe: () => ({ me: { activeOrg: { role: me.role, timezone: 'Africa/Lagos' } } }),
}));

const page = () =>
  render(
    <MemoryRouter>
      <ListingsPage />
    </MemoryRouter>,
  );

describe('Website → Listings page', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the rows in order with cover, unit count and badges', () => {
    listings.mockReturnValue({
      data: {
        items: [
          listing({ id: 'l1', coverPhotoId: 'ph1', photos: [{ id: 'ph1', alt: '', category: 'Bedrooms', width: 800, height: 600, sortOrder: 0, ready: true, failed: false, previewUrl: 'https://media.boogbe.test/org/o/listing/ph1-480.webp' }] }),
          listing({ id: 'l2', name: 'Kairo', slug: 'kairo', published: true, units: [unit, { ...unit, id: 'u2', name: 'Kairo 2' }] }),
        ],
      },
      mutate: vi.fn(),
    });
    page();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Destiny'), expect.stringContaining('Kairo')]),
    );
    expect(rows[0]!.querySelector('img')?.src).toBe('https://media.boogbe.test/org/o/listing/ph1-480.webp');
    expect(rows[0]).toHaveTextContent('1 unit');
    expect(rows[1]).toHaveTextContent('2 units');
    expect(rows[0]).toHaveTextContent('Draft');
    expect(rows[1]).toHaveTextContent('Published');
    // DOM order is the sort order.
    expect(screen.getByText('Destiny').compareDocumentPosition(screen.getByText('Kairo')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows View on website only for published listings, at the slug address', () => {
    listings.mockReturnValue({ data: { items: [listing({ published: true }), listing({ id: 'l2', name: 'Kairo', slug: 'kairo' })] }, mutate: vi.fn() });
    page();
    const links = screen.getAllByRole('link', { name: /view on website/i });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://tanuhomes.com/short-lets/destiny/');
  });

  it('New listing posts a draft and opens its editor', async () => {
    listings.mockReturnValue({ data: { items: [] }, mutate: vi.fn() });
    const post = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(listing({ id: 'new1', name: 'Alaska', slug: 'alaska' }))));
    page();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /new listing/i }));
    await user.type(screen.getByLabelText(/name/i), 'Alaska');
    await user.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/listings', expect.objectContaining({ method: 'POST' })),
    );
  });

  it('front desk sees no New listing button', () => {
    me.role = 'frontdesk';
    listings.mockReturnValue({ data: { items: [listing()] }, mutate: vi.fn() });
    page();
    expect(screen.queryByRole('button', { name: /new listing/i })).not.toBeInTheDocument();
    me.role = 'admin';
  });
});
