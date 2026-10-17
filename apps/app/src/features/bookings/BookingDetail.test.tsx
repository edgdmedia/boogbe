import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { BookingDetail } from './BookingDetail';

const booking = {
  id: 'b1',
  ref: 'TAN-2610-0001',
  status: 'tentative',
  source: 'whatsapp',
  holdUntil: null,
  guest: { id: 'g1', fullName: 'Chiamaka Obi', phoneE164: '+2348031234567' },
  unit: { id: 'u1', name: 'Kairo', propertyName: 'The Rock' },
  checkIn: '2026-10-18',
  checkOut: '2026-10-21',
  nights: 3,
  guestCount: 2,
  notes: null,
  history: [{ at: '2026-10-17T09:00:00Z', to: 'tentative', actorName: 'Tanu Admin', reason: null }],
  priceStale: false,
  lines: [{ kind: 'nightly', label: '3 nights × ₦262,500', amountKobo: 78_750_000 }],
  finalTotalKobo: 78_750_000,
  depositKobo: 0,
  overrideReason: null,
};

vi.mock('./hooks', async (orig) => ({ ...(await orig<typeof import('./hooks')>()), useBooking: () => ({ data: booking, mutate: vi.fn() }) }));
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  api: vi.fn(async () => ({})),
  useApi: () => ({ data: undefined, mutate: vi.fn() }),
}));
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { role: 'admin', timezone: 'Africa/Lagos' } } }) }));

describe('BookingDetail', () => {
  it('puts the ref, status and actions in the page header, with a way back on phones', () => {
    render(
      <MemoryRouter initialEntries={['/bookings/b1']}>
        <Routes>
          <Route path="/bookings/:id" element={<BookingDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    const h1 = screen.getByRole('heading', { level: 1, name: 'TAN-2610-0001' });
    const header = h1.closest('.border-b') as HTMLElement; // PageHeader's row
    expect(within(header).getByText('Tentative')).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to bookings' })).toHaveAttribute('href', '/bookings');
    expect(screen.getByRole('heading', { level: 2, name: 'History' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Price' })).toBeInTheDocument();
  });
});
