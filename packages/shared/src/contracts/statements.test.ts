import { describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORY_LABELS, ExpenseCategory, ExpenseInput, ExpenseListQuery } from './expenses';
import { PortalSummary } from './portal';
import { GenerateStatementsInput, MarkPaidInput, StatementDetail, StatementFiguresSchema } from './statements';

const unitExpense = { incurredOn: '2026-10-12', propertyId: 'p', unitId: 'u1', category: 'repairs', amountKobo: 5_000_000, description: 'Inverter battery', chargeToOwner: true };
const shared = { ...unitExpense, unitId: null, category: 'diesel', description: 'Diesel for the block' };
const issues = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) => (r.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]);

describe('ExpenseInput [OWN-01 OWN-02]', () => {
  it('a unit expense needs no allocation', () => {
    expect(ExpenseInput.safeParse(unitExpense).success).toBe(true);
  });
  it('a property-wide expense must say which units share it', () => {
    expect(issues(ExpenseInput.safeParse(shared))).toEqual([['allocation', 'Choose which units share a property-wide expense']]);
    expect(ExpenseInput.safeParse({ ...shared, allocation: { method: 'equal', unitIds: ['u1', 'u2'] } }).success).toBe(true);
  });
  it('a unit expense cannot also be allocated', () => {
    expect(ExpenseInput.safeParse({ ...unitExpense, allocation: { method: 'equal', unitIds: ['u1'] } }).success).toBe(false);
  });
  it('custom shares must cover the chosen units and add up to 100%', () => {
    const custom = (customBps?: Record<string, number>) => ExpenseInput.safeParse({ ...shared, allocation: { method: 'custom', unitIds: ['u1', 'u2'], customBps } });
    expect(custom({ u1: 6000, u2: 4000 }).success).toBe(true);
    expect(issues(custom({ u1: 6000, u2: 3000 }))).toEqual([['allocation.customBps', 'Shares must add up to 100%']]);
    expect(issues(custom(undefined))).toEqual([['allocation.customBps', 'Shares must add up to 100%']]);
    expect(issues(custom({ u1: 6000, u3: 4000 }))).toEqual([['allocation.customBps', 'Shares must add up to 100%']]);
  });
  it('refuses the same unit twice', () => {
    expect(ExpenseInput.safeParse({ ...shared, allocation: { method: 'equal', unitIds: ['u1', 'u1'] } }).success).toBe(false);
  });
  it('amount must be more than ₦0 and whole kobo', () => {
    expect(issues(ExpenseInput.safeParse({ ...unitExpense, amountKobo: 0 }))).toEqual([['amountKobo', 'Amount must be more than ₦0']]);
    expect(ExpenseInput.safeParse({ ...unitExpense, amountKobo: 10.5 }).success).toBe(false);
  });
  it('every category has a label', () => {
    expect(Object.keys(EXPENSE_CATEGORY_LABELS).sort()).toEqual([...ExpenseCategory.options].sort());
  });
});

describe('ExpenseListQuery', () => {
  it('refuses a range that ends before it starts', () => {
    expect(ExpenseListQuery.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
    expect(issues(ExpenseListQuery.safeParse({ from: '2026-10-31', to: '2026-10-01' }))).toEqual([['to', 'End date is before the start date']]);
  });
});

const figures = {
  period: '2026-10-01',
  units: [{ unitId: 'u', unitName: 'Kairo', propertyName: 'Rock', feeLabel: '20% of gross', grossKobo: 40_000_000, expensesKobo: 5_000_000, feeKobo: 8_000_000, fixedFeeKobo: 0, lines: [{ date: '2026-10-30', ref: 'R1', source: 'stay', amountKobo: 40_000_000 }] }],
  expenses: [{ date: '2026-10-12', unitName: 'Kairo', category: 'cleaning', description: 'Deep clean', amountKobo: 5_000_000 }],
  openingBalanceKobo: -1_000_000, grossKobo: 40_000_000, expensesKobo: 5_000_000, feeKobo: 8_000_000, fixedFeeKobo: 0, netPayoutKobo: 26_000_000,
  outstanding: [{ ref: 'R9', guestName: 'Ada', balanceKobo: 7_000_000 }],
};
const summary = {
  id: 's', number: null, owner: { id: 'o', name: 'Mrs Bello' }, period: '2026-10-01', status: 'draft',
  grossKobo: 40_000_000, expensesKobo: 5_000_000, feeKobo: 8_000_000, fixedFeeKobo: 0, openingBalanceKobo: -1_000_000, netPayoutKobo: 26_000_000,
  finalisedAt: null, paidOn: null, payoutReference: null,
};

describe('statement contracts [OWN-04 OWN-05]', () => {
  it('a statement detail carries its figures snapshot; negative balances are allowed', () => {
    expect(StatementDetail.parse({ ...summary, figures })).toMatchObject({ figures: { netPayoutKobo: 26_000_000, openingBalanceKobo: -1_000_000 } });
  });
  it('figures refuse fractional kobo and unknown revenue sources', () => {
    expect(StatementFiguresSchema.safeParse({ ...figures, feeKobo: 1.5 }).success).toBe(false);
    expect(StatementFiguresSchema.safeParse({ ...figures, units: [{ ...figures.units[0], lines: [{ date: '2026-10-30', ref: 'R1', source: 'deposit', amountKobo: 1 }] }] }).success).toBe(false);
  });
  it('statements are generated for a whole month', () => {
    expect(GenerateStatementsInput.safeParse({ period: '2026-10-01' }).success).toBe(true);
    expect(issues(GenerateStatementsInput.safeParse({ period: '2026-10-15' }))).toEqual([['period', 'Use the first day of the month']]);
  });
  it('marking paid needs a date and a reference', () => {
    expect(MarkPaidInput.parse({ paidOn: '2026-11-03', payoutReference: '  TRF-123  ' }).payoutReference).toBe('TRF-123');
    expect(MarkPaidInput.safeParse({ paidOn: '2026-11-03', payoutReference: ' x ' }).success).toBe(false);
    expect(MarkPaidInput.safeParse({ paidOn: '3/11/2026', payoutReference: 'TRF-123' }).success).toBe(false);
  });
});

describe('PortalSummary [OWN-08]', () => {
  const portal = { owner: { id: 'o', name: 'Mrs Bello' }, month: '2026-10-01', units: [{ id: 'u', name: 'Kairo', propertyName: 'Rock', occupancyPct: 64.5, revenueMtdKobo: 40_000_000 }], upcoming: [{ unitName: 'Kairo', checkIn: '2026-11-01', checkOut: '2026-11-04', nights: 3, guestName: null }], statements: [summary] };
  it('parses an owner summary', () => {
    expect(PortalSummary.safeParse(portal).success).toBe(true);
  });
  it('occupancy is a percentage', () => {
    expect(PortalSummary.safeParse({ ...portal, units: [{ ...portal.units[0], occupancyPct: 101 }] }).success).toBe(false);
  });
});
