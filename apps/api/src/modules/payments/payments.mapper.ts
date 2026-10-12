import type { PaymentEntry } from '@boogbe/shared';
import type { Payment } from '@prisma/client';
import { kobo } from '../inventory/mappers';

export function toEntries(rows: Payment[], names: Map<string, string>): PaymentEntry[] {
  const voided = new Set(rows.filter((r) => r.kind === 'void').map((r) => r.voidsPaymentId));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as PaymentEntry['kind'],
    amountKobo: kobo(r.amountKobo),
    method: r.method as PaymentEntry['method'],
    receivedOn: r.receivedOn.toISOString().slice(0, 10),
    reference: r.reference,
    note: r.note,
    receiptNo: r.receiptNo,
    voided: voided.has(r.id),
    voidsPaymentId: r.voidsPaymentId,
    recordedByName: r.recordedByMemberId ? (names.get(r.recordedByMemberId) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
  }));
}
