import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatusActions } from './StatusActions';

const { api, mutateLedger } = vi.hoisted(() => ({ api: vi.fn(async () => ({})), mutateLedger: vi.fn() }));

vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  api,
  useApi: () => ({
    data: { entries: [], totals: { paidKobo: 30_000_000, refundedKobo: 0, netPaidKobo: 30_000_000, depositReceivedKobo: 0, depositReturnedKobo: 0, depositWithheldKobo: 0, depositHeldKobo: 0, balanceKobo: 30_000_000, retainedKobo: 0 } },
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
