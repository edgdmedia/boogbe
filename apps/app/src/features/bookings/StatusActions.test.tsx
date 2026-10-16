import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusActions } from './StatusActions';

const { api, mutateLedger, paid } = vi.hoisted(() => ({ api: vi.fn(async () => ({})), mutateLedger: vi.fn(), paid: { kobo: 30_000_000 } }));

vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  api,
  useApi: () => ({
    data: { entries: [], totals: { paidKobo: paid.kobo, refundedKobo: 0, netPaidKobo: paid.kobo, depositReceivedKobo: 0, depositReturnedKobo: 0, depositWithheldKobo: 0, depositHeldKobo: 0, balanceKobo: 30_000_000, retainedKobo: 0 } },
    mutate: mutateLedger,
  }),
}));
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { role: 'admin', timezone: 'Africa/Lagos' } } }) }));

describe('StatusActions [BKG-07]', () => {
  it('revalidates the ledger after a transition so the payments panel refreshes', async () => {
    const onChanged = vi.fn();
    render(<StatusActions booking={{ id: 'b1', ref: 'TAN-1', status: 'confirmed' } as never} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: 'Check in' }));
    expect(api).toHaveBeenCalledWith('/v1/bookings/b1/transition', { method: 'POST', body: { to: 'checked_in' } });
    expect(mutateLedger).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });
});

describe('StatusActions — website requests [T-WB-07]', () => {
  const request = { id: 'b9', ref: 'TAN-9', status: 'tentative', source: 'website' } as never;
  beforeEach(() => {
    paid.kobo = 0;
  });
  afterEach(() => {
    paid.kobo = 30_000_000;
  });

  it('a website request someone already paid for keeps the normal cancel (with refund)', async () => {
    paid.kobo = 5_000_000;
    render(<StatusActions booking={request} onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cancel booking' })).toBeInTheDocument();
  });

  it('declines a website request with a preset reason and no refund section', async () => {
    api.mockClear();
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<StatusActions booking={request} onChanged={onChanged} />);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    expect(screen.queryByLabelText('Refund to guest')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Dates not available'));
    await user.click(screen.getByRole('button', { name: 'Decline request' }));
    expect(api).toHaveBeenCalledWith('/v1/bookings/b9/cancel', { method: 'POST', body: { reason: 'Dates not available' } });
    expect(onChanged).toHaveBeenCalled();
  });

  it('"Other" sends the typed reason', async () => {
    api.mockClear();
    const user = userEvent.setup();
    render(<StatusActions booking={request} onChanged={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    await user.click(screen.getByLabelText('Other (type it)'));
    await user.type(screen.getByLabelText('Reason'), 'Guest asked for a cheaper unit');
    await user.click(screen.getByRole('button', { name: 'Decline request' }));
    expect(api).toHaveBeenCalledWith('/v1/bookings/b9/cancel', { method: 'POST', body: { reason: 'Guest asked for a cheaper unit' } });
  });

  it('a blank "Other" reason is refused in the form and the dialog stays open; reopening starts fresh', async () => {
    api.mockClear();
    const user = userEvent.setup();
    render(<StatusActions booking={request} onChanged={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    await user.click(screen.getByLabelText('Other (type it)'));
    expect(screen.getByLabelText('Reason')).toHaveFocus();
    await user.type(screen.getByLabelText('Reason'), '   ');
    await user.click(screen.getByRole('button', { name: 'Decline request' }));
    expect(api).not.toHaveBeenCalled();
    expect(screen.getByText('Give a reason of at least 3 characters.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    expect(screen.getByLabelText('Dates not available')).toBeChecked();
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument();
  });

  it('a server error keeps the dialog open', async () => {
    const { ApiError } = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
    api.mockClear();
    api.mockRejectedValueOnce(new ApiError('VALIDATION_FAILED', 'Check the reason', 400));
    const user = userEvent.setup();
    render(<StatusActions booking={request} onChanged={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    await user.click(screen.getByRole('button', { name: 'Decline request' }));
    expect(await screen.findByText('Check the reason')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline request' })).toBeInTheDocument();
  });

  it('a request that changed meanwhile (hold expired, someone else acted) says so and refreshes', async () => {
    const { ApiError } = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
    api.mockClear();
    api.mockRejectedValueOnce(new ApiError('INVALID_TRANSITION', 'A cancelled booking cannot become cancelled', 422));
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<StatusActions booking={request} onChanged={onChanged} />);
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    await user.click(screen.getByLabelText('Could not reach guest'));
    await user.click(screen.getByRole('button', { name: 'Decline request' }));
    expect(await screen.findByText('This request changed. Refresh to see the latest.')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });
});
