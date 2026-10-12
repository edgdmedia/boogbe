import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GuestPicker } from './GuestPicker';

const ada = {
  id: 'g1',
  fullName: 'Adaeze Okafor',
  phoneE164: '+2348031234567',
  email: null,
  notes: null,
  bookingCount: 2,
  lifetimeValueKobo: 0,
  lastStayAt: null,
};

// useGuests is the seam the picker consumes (useApi closes over the module's own fetcher);
// GuestForm calls api() directly, so the match lookup is exercised through the mock here.
vi.mock('../../lib/api', () => ({
  api: vi.fn(async (path: string) => (path.startsWith('/v1/guests/match') ? { items: [ada] } : ada)),
  ApiError: class extends Error {
    code = 'INTERNAL';
    status = 0;
  },
  useApi: () => ({ data: undefined, mutate: vi.fn() }),
}));
vi.mock('./hooks', () => ({
  useGuests: (q: string) => ({
    data: { items: q && 'ada'.includes(q.toLowerCase().slice(0, 3)) ? [ada] : [ada], nextCursor: null },
    mutate: vi.fn(),
    isLoading: false,
  }),
}));

describe('GuestPicker', () => {
  it('finds an existing guest by search', async () => {
    const onChange = vi.fn();
    render(<GuestPicker value={null} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText(/find guest/i), 'ada');
    await userEvent.click(await screen.findByRole('option', { name: /Adaeze Okafor/ }));
    expect(onChange).toHaveBeenCalledWith(ada);
  });
  it('suggests an existing guest when the new phone matches [GST-03]', async () => {
    render(<GuestPicker value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /new guest/i }));
    await userEvent.type(screen.getByLabelText(/^phone/i), '08031234567');
    await userEvent.tab();
    expect(await screen.findByText(/This looks like Adaeze Okafor/)).toBeInTheDocument();
  });
});
