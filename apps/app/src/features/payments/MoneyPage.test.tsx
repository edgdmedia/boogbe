import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { MoneyPage } from './MoneyPage';

const summary = {
  receivedByMethod: [
    { method: 'bank_transfer', kobo: 40_000_000 },
    { method: 'pos', kobo: 15_000_000 },
  ],
  totalReceivedKobo: 55_000_000,
  refundsKobo: 0,
  depositsHeldKobo: 10_000_000,
  outstanding: [
    { id: 'b2', ref: 'TAN-2610-0002', unitName: 'Kairo', propertyName: 'Rock', guestName: 'Ada', checkIn: '2026-10-10', checkOut: '2026-10-12', nights: 2, status: 'confirmed', source: 'phone', finalTotalKobo: 40_000_000, balanceKobo: 20_000_000 },
  ],
  depositsToReturn: [{ bookingId: 'b1', ref: 'TAN-2610-0001', guestName: 'Ada', unitName: 'Kairo', checkOut: '2026-10-03', heldKobo: 10_000_000 }],
};

vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  api: vi.fn(async () => summary),
  // useApi from the real module closes over the real fetcher — serve the summary directly.
  useApi: () => ({ data: summary, mutate: vi.fn() }),
}));
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { role: 'admin', timezone: 'Africa/Lagos' } } }) }));

describe('MoneyPage', () => {
  it('shows totals, outstanding and deposits to return', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MemoryRouter>
          <MoneyPage />
        </MemoryRouter>
      </SWRConfig>,
    );
    expect(await screen.findByText('₦550,000')).toBeInTheDocument();
    expect(screen.getByText('Bank transfer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'TAN-2610-0002' })).toHaveAttribute('href', '/bookings/b2');
    expect(screen.getByRole('link', { name: 'TAN-2610-0001' })).toHaveAttribute('href', '/bookings/b1');
  });

  it('shows the three totals as stat tiles and the owed list as a card', () => {
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MemoryRouter>
          <MoneyPage />
        </MemoryRouter>
      </SWRConfig>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Money' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Guests who still owe' })).toBeInTheDocument();
    expect(screen.getByText('Received')).toHaveClass('eyebrow'); // StatTile label
  });
});
