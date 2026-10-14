import { z } from 'zod';
import { IsoDateSchema } from './common';

const K = z.number().int();
/** Snapshot stored on finalise; mirrors `StatementFigures` in domain/statement.ts. */
export const StatementFiguresSchema = z.object({
  period: z.string(),
  units: z.array(z.object({
    unitId: z.string(), unitName: z.string(), propertyName: z.string(), feeLabel: z.string(), grossKobo: K, expensesKobo: K, feeKobo: K, fixedFeeKobo: K,
    lines: z.array(z.object({ date: z.string(), ref: z.string(), source: z.enum(['stay', 'cancellation', 'damage']), amountKobo: K })),
  })),
  expenses: z.array(z.object({ date: z.string(), unitName: z.string(), category: z.string(), description: z.string(), amountKobo: K })),
  openingBalanceKobo: K, grossKobo: K, expensesKobo: K, feeKobo: K, fixedFeeKobo: K, netPayoutKobo: K,
  outstanding: z.array(z.object({ ref: z.string(), guestName: z.string(), balanceKobo: K })),
});
export type StatementFiguresSnapshot = z.infer<typeof StatementFiguresSchema>;
export const StatementStatus = z.enum(['draft', 'finalised', 'paid']);
export type StatementStatus = z.infer<typeof StatementStatus>;
export const StatementSummary = z.object({
  id: z.string(), number: z.string().nullable(), owner: z.object({ id: z.string(), name: z.string() }), period: z.string(), status: StatementStatus,
  grossKobo: K, expensesKobo: K, feeKobo: K, fixedFeeKobo: K, openingBalanceKobo: K, netPayoutKobo: K,
  finalisedAt: z.string().nullable(), paidOn: z.string().nullable(), payoutReference: z.string().nullable(),
});
export type StatementSummary = z.infer<typeof StatementSummary>;
export const StatementDetail = StatementSummary.extend({ figures: StatementFiguresSchema });
export type StatementDetail = z.infer<typeof StatementDetail>;
// "Not in the future" needs the operator's today, so the API checks it.
export const GenerateStatementsInput = z.object({ period: IsoDateSchema.refine((d) => d.endsWith('-01'), 'Use the first day of the month') });
export type GenerateStatementsInput = z.infer<typeof GenerateStatementsInput>;
export const MarkPaidInput = z.object({ paidOn: IsoDateSchema, payoutReference: z.string().trim().min(2).max(120) });
export type MarkPaidInput = z.infer<typeof MarkPaidInput>;
