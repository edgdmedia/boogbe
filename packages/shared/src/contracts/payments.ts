import { z } from 'zod';
import { IsoDateSchema, Kobo } from './common';

export const PaymentMethod = z.enum(['bank_transfer', 'cash', 'pos', 'card', 'paystack', 'other']);
export type PaymentMethod = z.infer<typeof PaymentMethod>;
export const METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
  pos: 'POS',
  card: 'Card',
  paystack: 'Paystack',
  other: 'Other',
};
export const EntryKindEnum = z.enum(['payment', 'refund', 'deposit_received', 'deposit_returned', 'deposit_withheld', 'void']);
export const ENTRY_LABELS: Record<z.infer<typeof EntryKindEnum>, string> = {
  payment: 'Payment',
  refund: 'Refund',
  deposit_received: 'Deposit received',
  deposit_returned: 'Deposit returned',
  deposit_withheld: 'Deposit kept',
  void: 'Void',
};

export const RecordEntryInput = z
  .object({
    kind: EntryKindEnum.exclude(['void']),
    amountKobo: Kobo.refine((v) => v > 0, 'Amount must be more than ₦0'),
    method: PaymentMethod,
    receivedOn: IsoDateSchema,
    reference: z.string().trim().max(120).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((x) => x.kind !== 'deposit_withheld' || (x.note && x.note.length >= 3), {
    path: ['note'],
    message: 'Say why the deposit is kept',
  });
export type RecordEntryInput = z.infer<typeof RecordEntryInput>;
export const VoidInput = z.object({ paymentId: z.string(), reason: z.string().trim().min(3).max(300) });
export type VoidInput = z.infer<typeof VoidInput>;

export const PaymentEntry = z.object({
  id: z.string(),
  kind: EntryKindEnum,
  amountKobo: z.number().int(),
  method: PaymentMethod,
  receivedOn: z.string(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  receiptNo: z.string().nullable(),
  voided: z.boolean(),
  voidsPaymentId: z.string().nullable(),
  recordedByName: z.string().nullable(),
  createdAt: z.string(),
});
export type PaymentEntry = z.infer<typeof PaymentEntry>;
export const LedgerTotalsSchema = z.object({
  paidKobo: z.number().int(),
  refundedKobo: z.number().int(),
  netPaidKobo: z.number().int(),
  depositReceivedKobo: z.number().int(),
  depositReturnedKobo: z.number().int(),
  depositWithheldKobo: z.number().int(),
  depositHeldKobo: z.number().int(),
  balanceKobo: z.number().int(),
  retainedKobo: z.number().int(),
});
export const BookingLedger = z.object({ entries: z.array(PaymentEntry), totals: LedgerTotalsSchema });
export type BookingLedger = z.infer<typeof BookingLedger>;
