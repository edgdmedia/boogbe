import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { Unit } from '@boogbe/shared';
import { UnitForm } from './UnitForm';

const unit: Unit = {
  id: 'u1',
  propertyId: 'p1',
  name: 'Kairo',
  bedrooms: 2,
  maxGuests: 4,
  nightlyRateKobo: 20_000_000,
  defaultAssigneeMemberId: null,
  checkInInstructions: null,
  sortOrder: 0,
  active: true,
  publicListed: false,
  feeOverride: false,
  feeType: 'none',
  feeBps: 0,
  feeFixedMonthlyKobo: 0,
  ownerFollowsProperty: true,
  currentOwner: null,
  currentOwnerSource: 'operator',
};

function serve() {
  const bodies: Record<string, unknown>[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    return new Response(JSON.stringify({ ...unit, ...body }));
  });
  return bodies;
}

describe('UnitForm — Show on website', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists an existing unit on the website', async () => {
    const bodies = serve();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<UnitForm propertyId="p1" initial={unit} onSaved={onSaved} />);
    const box = screen.getByLabelText('Show on website');
    expect(box).not.toBeChecked();
    expect(
      screen.getByText('Guests can see availability and request this apartment on your website.'),
    ).toBeInTheDocument();
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Save unit' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(bodies[0]).toMatchObject({ publicListed: true });
  });

  it('a new unit starts hidden from the website', async () => {
    const bodies = serve();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<UnitForm propertyId="p1" onSaved={onSaved} />);
    await user.type(screen.getByLabelText('Unit name'), 'Zuri');
    await user.type(screen.getByLabelText('Nightly rate'), '50000');
    await user.click(screen.getByRole('button', { name: 'Save unit' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(bodies[0]).toMatchObject({ publicListed: false });
  });
});

// The listing link line (T-WL-08): which website page, if any, holds this unit.
const listings: unknown[] = [];
vi.mock('../website/hooks', () => ({ useListings: () => ({ data: { items: listings }, mutate: vi.fn() }) }));

describe('UnitForm — On website line', () => {
  afterEach(() => {
    listings.length = 0;
  });

  const withRouter = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

  it('says Not on your website when no listing holds the unit', () => {
    withRouter(<UnitForm propertyId="p1" initial={unit} onSaved={vi.fn()} />);
    expect(screen.getByText('Not on your website')).toBeInTheDocument();
  });

  it('names the listing and its option label, linking to the editor', () => {
    listings.push({ id: 'l1', name: 'Destiny', slug: 'destiny', units: [{ id: 'u1', label: '1 bedroom' }] });
    withRouter(<UnitForm propertyId="p1" initial={unit} onSaved={vi.fn()} />);
    expect(screen.getByText('On website:')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Destiny/ });
    expect(link).toHaveAttribute('href', '/website/listings/l1');
    expect(link.textContent).toContain('Destiny');
    expect(link.textContent).toContain('1 bedroom');
  });
});
