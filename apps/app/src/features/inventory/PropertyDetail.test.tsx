import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { PropertyDetail } from './PropertyDetail';

const property = {
  id: 'p1',
  name: 'The Rock',
  address: 'Lekki',
  area: null,
  notes: null,
  sortOrder: 0,
  active: true,
  unitCount: 1,
  feeType: 'pct_gross',
  feeBps: 2000,
  feeFixedMonthlyKobo: 0,
  defaultOwnerId: null,
  defaultOwnerName: null,
};
const unit = {
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
  feeOverride: false,
  feeType: 'none',
  feeBps: 0,
  feeFixedMonthlyKobo: 0,
  ownerFollowsProperty: true,
  currentOwner: { id: 'o1', name: 'Mrs Adebayo' },
  currentOwnerSource: 'property',
};

// The plan mocked lib/api, but useApi closes over the module's own api — swapping the export
// doesn't reach it. The hooks layer is the seam the component actually consumes.
vi.mock('./hooks', () => ({
  useProperty: () => ({ data: property, mutate: vi.fn() }),
  useUnits: () => ({ data: { items: [unit] }, mutate: vi.fn() }),
  useOwners: () => ({ data: { items: [] }, mutate: vi.fn() }),
  useUnitFees: () => ({ data: { items: [] }, mutate: vi.fn() }),
  useProperties: () => ({ data: { items: [] }, mutate: vi.fn() }),
}));
// The panel is CalendarSyncPanel's own test's subject; here we only care that the dialog opens/closes.
vi.mock('../ical/CalendarSyncPanel', () => ({ CalendarSyncPanel: () => <p>sync panel stub</p> }));
vi.mock('../../lib/use-me', () => ({
  useMe: () => ({ me: { activeOrg: { role: 'admin', timezone: 'Africa/Lagos' } } }),
}));

describe('PropertyDetail', () => {
  it('lists units with rate, owner and where the owner comes from', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MemoryRouter initialEntries={['/settings/properties/p1']}>
          <Routes>
            <Route path="/settings/properties/:id" element={<PropertyDetail />} />
          </Routes>
        </MemoryRouter>
      </SWRConfig>,
    );
    expect(await screen.findByText('Kairo')).toBeInTheDocument();
    // the rate sits inside the whole line ("2 bed · up to 4 guests · ₦200,000 / night")
    expect(screen.getByText(/₦200,000 \/ night/)).toBeInTheDocument();
    expect(screen.getByText('Mrs Adebayo (from property)')).toBeInTheDocument();
    expect(screen.getByText('20% of gross')).toBeInTheDocument();
  });

  it('opens the sync dialog from ?unit= and clears the param so closing sticks', async () => {
    const search = { current: '' };
    function Spy() {
      const [q] = useSearchParams();
      search.current = q.toString();
      return null;
    }
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MemoryRouter initialEntries={['/settings/properties/p1?unit=u1#calendar-sync']}>
          <Routes>
            <Route path="/settings/properties/:id" element={<><PropertyDetail /><Spy /></>} />
          </Routes>
        </MemoryRouter>
      </SWRConfig>,
    );
    expect(await screen.findByText('sync panel stub')).toBeInTheDocument();
    // Without clearing, any later revalidation re-runs the effect and re-opens a dialog the user closed.
    expect(search.current).not.toContain('unit=');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('sync panel stub')).not.toBeInTheDocument();
  });
});
