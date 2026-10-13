import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditBookingForm } from './EditBookingDialog';

const booking = {
  id: 'b1',
  ref: 'TAN-2611-0001',
  status: 'confirmed',
  checkIn: '2026-11-01',
  checkOut: '2026-11-04',
  guestCount: 2,
  notes: null,
  priceStale: false,
  finalTotalKobo: 60_000_000,
  computedTotalKobo: 60_000_000,
  depositKobo: 10_000_000,
  overrideReason: null,
  unit: { id: 'u1', name: 'Kairo', propertyName: 'The Rock Apartments', maxGuests: 4 },
};
const units = {
  items: [
    { id: 'u1', name: 'Kairo', maxGuests: 4 },
    { id: 'u2', name: 'Alaska', maxGuests: 2 },
  ],
};

const mockApi = vi.fn(async (_path: string, _init?: { body?: unknown }) => ({}));
vi.mock('../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../lib/api')>();
  return {
    ...real,
    api: (path: string, init?: { body?: unknown }) => mockApi(path, init),
    useApi: (path: string | null) => ({ data: path === '/v1/units' ? units : undefined, mutate: vi.fn() }),
  };
});
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { role: 'admin', timezone: 'Africa/Lagos' } } }) }));

function renderForm(onSaved = vi.fn()) {
  render(<EditBookingForm booking={booking as never} onSaved={onSaved} />);
  return onSaved;
}

describe('EditBookingForm [BKG-05 T-M2-11]', () => {
  it('requires a reason when the total changes, client-side', async () => {
    mockApi.mockClear();
    renderForm();
    // open the override and set a new total without a reason
    await userEvent.clear(screen.getByLabelText('Total'));
    await userEvent.type(screen.getByLabelText('Total'), '550000');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/reason/i);
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('sends unitId when moving the booking and reason with the new total', async () => {
    mockApi.mockClear();
    const onSaved = renderForm();
    await userEvent.selectOptions(screen.getByLabelText('Unit'), 'u2');
    await userEvent.clear(screen.getByLabelText('Total'));
    await userEvent.type(screen.getByLabelText('Total'), '550000');
    await userEvent.type(screen.getByLabelText('Reason (if total changed)'), 'Moving to smaller unit');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    const [, init] = mockApi.mock.calls[0] as unknown as [string, { body: Record<string, unknown> }];
    expect(init.body).toMatchObject({ unitId: 'u2', finalTotalKobo: 55_000_000, overrideReason: 'Moving to smaller unit' });
    expect(onSaved).toHaveBeenCalled();
  });
});
