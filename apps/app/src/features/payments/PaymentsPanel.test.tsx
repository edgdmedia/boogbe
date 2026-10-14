import { render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { PaymentsPanel } from './PaymentsPanel';

const ledger = {
  entries: [
    { id: 'p1', kind: 'payment', amountKobo: 70_000_000, method: 'bank_transfer', receivedOn: '2026-10-10', reference: 'GTB-1', note: null, receiptNo: 'TAN-R-000001', voided: false, voidsPaymentId: null, recordedByName: 'Ada', createdAt: '2026-10-10T10:00:00Z' },
    { id: 'p2', kind: 'payment', amountKobo: 5_000_000, method: 'cash', receivedOn: '2026-10-10', reference: null, note: null, receiptNo: 'TAN-R-000002', voided: true, voidsPaymentId: null, recordedByName: 'Ada', createdAt: '2026-10-10T11:00:00Z' },
  ],
  totals: { paidKobo: 70_000_000, refundedKobo: 0, netPaidKobo: 70_000_000, depositReceivedKobo: 0, depositReturnedKobo: 0, depositWithheldKobo: 0, depositHeldKobo: 0, balanceKobo: -10_000_000, retainedKobo: 70_000_000 },
};
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  api: vi.fn(async () => ledger),
  // useApi from the real module closes over the real fetcher; serve the ledger directly.
  useApi: () => ({ data: ledger, mutate: vi.fn() }),
}));
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { role: 'admin', timezone: 'Africa/Lagos' } } }) }));

describe('PaymentsPanel', () => {
  it('shows overpaid, receipt links and struck-through voids', async () => {
    const booking = { id: 'b1', status: 'confirmed', finalTotalKobo: 60_000_000 } as never;
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <PaymentsPanel booking={booking} refresh={vi.fn()} />
      </SWRConfig>,
    );
    expect(await screen.findByText('Overpaid')).toBeInTheDocument();
    expect(screen.getByText('₦100,000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'TAN-R-000001' })).toHaveAttribute('href', '/v1/payments/p1/receipt.pdf');
    expect(screen.getByText('₦50,000').closest('tr')).toHaveClass('line-through');
    expect(screen.getAllByRole('button', { name: 'Void' })).toHaveLength(1);
  });
});
