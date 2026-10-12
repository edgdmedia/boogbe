import { describe, expect, it } from 'vitest';
import { effectiveEntries, ledger, validateEntry, type LedgerEntry } from './ledger';

const e = (id: string, kind: LedgerEntry['kind'], amountKobo: number, voidsPaymentId: string | null = null): LedgerEntry => ({
  id,
  kind,
  amountKobo,
  voidsPaymentId,
});

describe('ledger [PAY-05]', () => {
  const entries = [e('p1', 'payment', 30_000_000), e('p2', 'payment', 20_000_000), e('d1', 'deposit_received', 10_000_000), e('r1', 'refund', 5_000_000)];
  it('computes balance and deposit held', () => {
    expect(ledger(entries, { finalTotalKobo: 60_000_000, status: 'confirmed' })).toEqual({
      paidKobo: 50_000_000,
      refundedKobo: 5_000_000,
      netPaidKobo: 45_000_000,
      depositReceivedKobo: 10_000_000,
      depositReturnedKobo: 0,
      depositWithheldKobo: 0,
      depositHeldKobo: 10_000_000,
      balanceKobo: 15_000_000,
      retainedKobo: 45_000_000,
    });
  });
  it('excludes voided entries and the void itself', () => {
    const t = ledger([...entries, e('v1', 'void', 20_000_000, 'p2')], { finalTotalKobo: 60_000_000, status: 'confirmed' });
    expect(t.paidKobo).toBe(30_000_000);
    expect(t.balanceKobo).toBe(35_000_000);
    expect(effectiveEntries([...entries, e('v1', 'void', 20_000_000, 'p2')]).map((x) => x.id)).toEqual(['p1', 'd1', 'r1']);
  });
  it('cancelled bookings owe nothing; retained is net paid', () => {
    expect(ledger(entries, { finalTotalKobo: 60_000_000, status: 'cancelled' })).toMatchObject({ balanceKobo: 0, retainedKobo: 45_000_000 });
  });
  it('overpayment gives negative balance', () => {
    expect(ledger([e('p', 'payment', 70_000_000)], { finalTotalKobo: 60_000_000, status: 'confirmed' }).balanceKobo).toBe(-10_000_000);
  });
});

describe('validateEntry [PAY-02 PAY-03 PAY-04]', () => {
  const base = [e('p1', 'payment', 50_000_000), e('d1', 'deposit_received', 10_000_000)];
  it('refund cannot exceed net paid', () => {
    expect(validateEntry(base, { kind: 'refund', amountKobo: 50_000_001 })).toBe('Refund is more than the guest has paid (₦500,000)');
    expect(validateEntry(base, { kind: 'refund', amountKobo: 50_000_000 })).toBeNull();
  });
  it('deposit return/withhold cannot exceed held', () => {
    expect(validateEntry(base, { kind: 'deposit_returned', amountKobo: 10_000_001 })).toBe('Only ₦100,000 deposit is held');
    expect(validateEntry([...base, e('w', 'deposit_withheld', 4_000_000)], { kind: 'deposit_returned', amountKobo: 7_000_000 })).toBe(
      'Only ₦60,000 deposit is held',
    );
  });
  it('void twice refused; void of a void refused; unknown target refused', () => {
    const withVoid = [...base, e('v1', 'void', 50_000_000, 'p1')];
    expect(validateEntry(withVoid, { kind: 'void', amountKobo: 50_000_000, voidsPaymentId: 'p1' })).toBe('That entry is already voided');
    expect(validateEntry(withVoid, { kind: 'void', amountKobo: 50_000_000, voidsPaymentId: 'v1' })).toBe('A void cannot be voided');
    expect(validateEntry(base, { kind: 'void', amountKobo: 1, voidsPaymentId: 'nope' })).toBe('Entry not found');
  });
  it('voiding a payment that funded a later refund is refused', () => {
    const t = [e('p1', 'payment', 50_000_000), e('r1', 'refund', 50_000_000)];
    expect(validateEntry(t, { kind: 'void', amountKobo: 50_000_000, voidsPaymentId: 'p1' })).toBe('Void the refund first — it would exceed what was paid');
  });
});
