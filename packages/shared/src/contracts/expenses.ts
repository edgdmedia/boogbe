import { z } from 'zod';
import { IsoDateSchema, Kobo } from './common';

export const ExpenseCategory = z.enum(['cleaning', 'repairs', 'utilities', 'diesel', 'estate_dues', 'supplies', 'internet', 'other']);
export type ExpenseCategory = z.infer<typeof ExpenseCategory>;
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = { cleaning: 'Cleaning', repairs: 'Repairs', utilities: 'Electricity & water', diesel: 'Diesel / generator', estate_dues: 'Estate dues', supplies: 'Supplies', internet: 'Internet', other: 'Other' };

export const ExpenseAllocationInput = z.object({
  method: z.enum(['equal', 'custom']),
  unitIds: z.array(z.string()).min(1).refine((ids) => new Set(ids).size === ids.length, 'A unit is chosen twice'),
  customBps: z.record(z.string(), z.number().int().min(0).max(10_000)).optional(),
});
export const ExpenseInput = z.object({
  incurredOn: IsoDateSchema, propertyId: z.string(), unitId: z.string().nullable(), category: ExpenseCategory,
  amountKobo: Kobo.refine((v) => v > 0, 'Amount must be more than ₦0'), description: z.string().trim().min(2).max(300),
  chargeToOwner: z.boolean(), receiptFileId: z.string().nullable().optional(),
  allocation: ExpenseAllocationInput.optional(),
}).superRefine((e, ctx) => {
  if ((e.unitId === null) !== !!e.allocation) {
    ctx.addIssue({ code: 'custom', path: ['allocation'], message: 'Choose which units share a property-wide expense' });
    return;
  }
  // Same rule as domain/allocation: shares over the chosen units must total exactly 100%.
  const a = e.allocation;
  if (a?.method === 'custom' && a.unitIds.reduce((t, id) => t + (a.customBps?.[id] ?? 0), 0) !== 10_000) {
    ctx.addIssue({ code: 'custom', path: ['allocation', 'customBps'], message: 'Shares must add up to 100%' });
  }
});
export type ExpenseInput = z.infer<typeof ExpenseInput>;
export const Expense = z.object({
  id: z.string(), incurredOn: z.string(), property: z.object({ id: z.string(), name: z.string() }), unit: z.object({ id: z.string(), name: z.string() }).nullable(),
  category: ExpenseCategory, amountKobo: z.number().int(), description: z.string(), chargeToOwner: z.boolean(), receiptFileId: z.string().nullable(),
  allocations: z.array(z.object({ unitId: z.string(), unitName: z.string(), shareBps: z.number().int(), amountKobo: z.number().int() })),
  locked: z.boolean(), createdAt: z.string(),
});
export type Expense = z.infer<typeof Expense>;
export const ExpenseListQuery = z.object({ from: IsoDateSchema, to: IsoDateSchema, propertyId: z.string().optional(), category: ExpenseCategory.optional() })
  .refine((q) => q.from <= q.to, { path: ['to'], message: 'End date is before the start date' });
export type ExpenseListQuery = z.infer<typeof ExpenseListQuery>;
