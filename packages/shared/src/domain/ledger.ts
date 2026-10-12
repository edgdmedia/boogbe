import type { BookingStatus } from '../contracts/calendar';
import { formatNaira, sumKobo } from './money';

export type EntryKind = 'payment' | 'refund' | 'deposit_received' | 'deposit_returned' | 'deposit_withheld' | 'void';
export interface LedgerEntry {
  id: string;
  kind: EntryKind;
  amountKobo: number;
  voidsPaymentId: string | null;
}
export interface LedgerTotals {
  paidKobo: number;
  refundedKobo: number;
  netPaidKobo: number;
  depositReceivedKobo: number;
  depositReturnedKobo: number;
  depositWithheldKobo: number;
  depositHeldKobo: number;
  balanceKobo: number;
  retainedKobo: number;
}

/** The ledger is append-only: a correction is a `void` row, and both it and its target drop out of every sum. */
export function effectiveEntries(entries: LedgerEntry[]): LedgerEntry[] {
  const voided = new Set(entries.filter((x) => x.kind === 'void').map((x) => x.voidsPaymentId));
  return entries.filter((x) => x.kind !== 'void' && !voided.has(x.id));
}

const sumOf = (es: LedgerEntry[], k: EntryKind) => sumKobo(es.filter((x) => x.kind === k).map((x) => x.amountKobo));

/** PAY-05. Balance is never stored; negative means the guest has overpaid. Cancelled bookings owe nothing. */
export function ledger(entries: LedgerEntry[], b: { finalTotalKobo: number; status: BookingStatus }): LedgerTotals {
  const es = effectiveEntries(entries);
  const paid = sumOf(es, 'payment');
  const refunded = sumOf(es, 'refund');
  const dr = sumOf(es, 'deposit_received');
  const dret = sumOf(es, 'deposit_returned');
  const dw = sumOf(es, 'deposit_withheld');
  const net = paid - refunded;
  return {
    paidKobo: paid,
    refundedKobo: refunded,
    netPaidKobo: net,
    depositReceivedKobo: dr,
    depositReturnedKobo: dret,
    depositWithheldKobo: dw,
    depositHeldKobo: dr - dret - dw,
    balanceKobo: b.status === 'cancelled' ? 0 : b.finalTotalKobo - net,
    retainedKobo: net,
  };
}

/** Returns a plain-English reason the entry can't be recorded, or null. */
export function validateEntry(
  entries: LedgerEntry[],
  next: { kind: EntryKind; amountKobo: number; voidsPaymentId?: string | null },
): string | null {
  if (!Number.isSafeInteger(next.amountKobo) || next.amountKobo <= 0) return 'Amount must be more than ₦0';
  const t = ledger(entries, { finalTotalKobo: 0, status: 'confirmed' });
  switch (next.kind) {
    case 'refund':
      return next.amountKobo > t.netPaidKobo ? `Refund is more than the guest has paid (${formatNaira(t.netPaidKobo)})` : null;
    case 'deposit_returned':
    case 'deposit_withheld':
      return next.amountKobo > t.depositHeldKobo ? `Only ${formatNaira(t.depositHeldKobo)} deposit is held` : null;
    case 'void': {
      const target = entries.find((x) => x.id === next.voidsPaymentId);
      if (!target) return 'Entry not found';
      if (target.kind === 'void') return 'A void cannot be voided';
      if (entries.some((x) => x.kind === 'void' && x.voidsPaymentId === target.id)) return 'That entry is already voided';
      const after = ledger([...entries, { id: '_', kind: 'void', amountKobo: target.amountKobo, voidsPaymentId: target.id }], {
        finalTotalKobo: 0,
        status: 'confirmed',
      });
      if (after.netPaidKobo < 0) return 'Void the refund first — it would exceed what was paid';
      if (after.depositHeldKobo < 0) return 'Void the deposit return first — it would exceed what was received';
      return null;
    }
    default:
      return null;
  }
}
