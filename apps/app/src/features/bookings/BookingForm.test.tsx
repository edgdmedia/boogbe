import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { BookingForm } from './BookingForm';

const quote = {
  nights: 3,
  lines: [
    { kind: 'accommodation', feeKind: null, label: '3 nights × ₦200,000', quantity: 3, unitAmountKobo: 20_000_000, amountKobo: 60_000_000, refundable: false, recognition: 'per_night' },
    { kind: 'deposit', feeKind: 'caution_deposit', label: 'Caution deposit', quantity: 1, unitAmountKobo: 10_000_000, amountKobo: 10_000_000, refundable: true, recognition: 'on_check_in' },
  ],
  computedTotalKobo: 60_000_000,
  finalTotalKobo: 60_000_000,
  depositKobo: 10_000_000,
  available: true,
  conflict: null,
  warnings: [],
  maxGuests: 4,
};
const guest = { id: 'g1', fullName: 'Adaeze Okafor', phoneE164: '+2348031234567', email: null, notes: null, bookingCount: 0, lifetimeValueKobo: 0, lastStayAt: null };
const calls: { path: string; body?: unknown }[] = [];
let createAttempts = 0;

vi.mock('../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../lib/api')>();
  const api = vi.fn(async (path: string, init?: { body?: unknown }) => {
    calls.push({ path, body: init?.body });
    if (path === '/v1/bookings/quote') return quote;
    if (path.startsWith('/v1/units')) return { items: [{ id: 'u1', name: 'Kairo', propertyId: 'p', maxGuests: 4, active: true }] };
    if (path.startsWith('/v1/guests?')) return { items: [guest], nextCursor: null };
    if (path === '/v1/bookings') {
      createAttempts++;
      if (createAttempts === 1)
        throw new real.ApiError('ICAL_OVERLAP', 'overlap', 409, {
          warnings: [{ kind: 'ical_overlap', blockId: 'x', summary: 'Airbnb (Not available)' }],
        });
      return { id: 'b1', ref: 'TAN-2610-0001' };
    }
    return {};
  });
  return {
    ...real,
    api,
    // useApi would close over the real api; the component tree only reads through it once each,
    // so a plain resolved-data stub is enough (no SWR inside the mock).
    useApi: (path: string | null) => ({
      data:
        path === '/v1/units'
          ? { items: [{ id: 'u1', name: 'Kairo', maxGuests: 4 }] }
          : path && path.startsWith('/v1/guests?')
            ? { items: [guest], nextCursor: null }
            : undefined,
      mutate: vi.fn(),
    }),
  };
});
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { role: 'frontdesk', timezone: 'Africa/Lagos' } } }) }));

describe('BookingForm', () => {
  it('shows the live quote and acknowledges an iCal overlap', async () => {
    const onCreated = vi.fn();
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <BookingForm unitId="u1" checkIn="2026-11-01" checkOut="2026-11-04" onCreated={onCreated} />
      </SWRConfig>,
    );
    expect(await screen.findByText('3 nights × ₦200,000')).toBeInTheDocument();
    // line and total are both ₦600,000 in this fixture — pin the Total row itself
    expect(screen.getByText('Total').closest('div')?.textContent).toContain('₦600,000');
    expect(screen.getByText(/Caution deposit.*refundable/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/find guest/i), 'ada');
    await userEvent.click(await screen.findByRole('option', { name: /Adaeze/ }));
    await userEvent.click(screen.getByRole('button', { name: /save booking/i }));
    expect(await screen.findByText(/Airbnb \(Not available\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/not on the other channel/i));
    await userEvent.click(screen.getByRole('button', { name: /save booking/i }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(calls.filter((c) => c.path === '/v1/bookings').at(-1)!.body).toMatchObject({
      acknowledgeIcalOverlap: true,
      guestId: 'g1',
      unitId: 'u1',
    });
  });

  it('never offers "Website" as a source: only the public booking API creates those', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <BookingForm unitId="u1" checkIn="2026-11-01" checkOut="2026-11-04" onCreated={vi.fn()} />
      </SWRConfig>,
    );
    const select = screen.getByLabelText(/booked via/i);
    const labels = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toContain('WhatsApp');
    expect(labels).not.toContain('Website');
  });
});
