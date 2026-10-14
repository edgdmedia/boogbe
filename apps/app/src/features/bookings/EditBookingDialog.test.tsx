import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditBookingForm } from './EditBookingDialog';

const units = {
  items: [
    { id: 'u1', name: 'Kairo', maxGuests: 4, propertyId: 'p1', active: true },
    { id: 'u2', name: 'Kairo', maxGuests: 2, propertyId: 'p2', active: false },
    { id: 'u3', name: 'Sable', maxGuests: 2, propertyId: 'p1', active: false },
  ],
};
const properties = { items: [{ id: 'p1', name: 'The Rock' }, { id: 'p2', name: 'Josephine’s (Ologolo)' }] };

vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  api: vi.fn(async () => ({})),
  useApi: (path: string | null) => ({
    data: path?.startsWith('/v1/units') ? units : path?.startsWith('/v1/properties') ? properties : undefined,
    mutate: vi.fn(),
  }),
}));
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { role: 'admin', timezone: 'Africa/Lagos' } } }) }));

const booking = {
  id: 'b1',
  ref: 'TAN-1',
  status: 'confirmed',
  unit: { id: 'u2', name: 'Kairo', propertyName: 'Josephine’s (Ologolo)' },
  guest: { id: 'g1', fullName: 'A', phoneE164: '+2348031234567' },
  checkIn: '2026-11-01',
  checkOut: '2026-11-03',
  guestCount: 1,
  nights: 2,
  notes: null,
  finalTotalKobo: 1000,
  lines: [],
  depositKobo: 0,
  priceStale: false,
  overrideReason: null,
  history: [],
} as never;

describe('EditBookingForm unit select [T-M2-12]', () => {
  it('groups by property, flags archived units and keeps the current one selectable', () => {
    render(<EditBookingForm booking={booking} onSaved={vi.fn()} />);
    // two "Kairo"s, distinguishable by their group
    expect(screen.getByRole('group', { name: 'The Rock' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Josephine’s (Ologolo)' })).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toContain('Kairo (archived)');
    // a DIFFERENT archived unit is visible but disabled — the API refuses moves onto it (T-M2-12 review)
    expect(screen.getByRole('option', { name: 'Sable (archived)' })).toBeDisabled();
    // the booking's own archived unit is enabled, selected, and not a blank
    const own = screen.getByRole('option', { name: 'Kairo (archived)' });
    expect(own).toBeEnabled();
    expect(own).toHaveAttribute('value', 'u2');
    expect(screen.getByRole('combobox', { name: 'Unit' })).toHaveValue('u2');
  });
});
