import type { FeeConfig } from '../contracts/inventory';
import { addDays, eachNight, type IsoDate } from './dates';
import { assertKobo, formatNaira, pctOfBps, sumKobo } from './money';
import { ownerOn, type OwnershipPeriod } from './ownership';
import { inMonth, type RevenueEntry } from './revenue';

export interface StatementInput {
  ownerId: string; period: IsoDate;
  units: { unitId: string; unitName: string; propertyName: string; fee: FeeConfig }[];
  ownership: Record<string, OwnershipPeriod[]>;
  revenue: RevenueEntry[];
  expenses: { expenseId: string; unitId: string; date: IsoDate; category: string; description: string; amountKobo: number }[];
  openingBalanceKobo: number;
  outstanding: { ref: string; guestName: string; balanceKobo: number }[];
}
export interface StatementUnit { unitId: string; unitName: string; propertyName: string; feeLabel: string; grossKobo: number; expensesKobo: number; feeKobo: number; fixedFeeKobo: number; lines: { date: IsoDate; ref: string; source: RevenueEntry['source']; amountKobo: number }[] }
export interface StatementExpense { date: IsoDate; unitName: string; category: string; description: string; amountKobo: number }
export interface StatementFigures { period: IsoDate; units: StatementUnit[]; expenses: StatementExpense[]; openingBalanceKobo: number; grossKobo: number; expensesKobo: number; feeKobo: number; fixedFeeKobo: number; netPayoutKobo: number; outstanding: StatementInput['outstanding'] }

const assertPeriod = (period: IsoDate) => {
  if (!/^\d{4}-\d{2}-01$/.test(period)) throw new Error('Period must be the first day of a month');
};
const nextMonth = (period: IsoDate) => `${addDays(period, 31).slice(0, 7)}-01`;

/** True if the owner held the unit for at least one day of the month (`to` is exclusive). */
export function ownedDuring(periods: OwnershipPeriod[], ownerId: string, period: IsoDate): boolean {
  assertPeriod(period);
  const end = nextMonth(period);
  return periods.some((p) => p.ownerId === ownerId && p.from < end && (p.to === null || p.to > period));
}

export const feeLabel = (f: FeeConfig) => {
  const pct = `${f.feeBps / 100}%`;
  const base = f.feeType === 'pct_gross' ? `${pct} of gross` : f.feeType === 'pct_net' ? `${pct} of net` : 'No commission';
  return f.feeFixedMonthlyKobo ? `${base} + ${formatNaira(f.feeFixedMonthlyKobo)}/month` : base;
};

/**
 * D-024: the fixed monthly fee is split by days owned in the month (operator-owned days included, never charged to an owner).
 * Largest-remainder rounding, earliest owner first on a tie, so the parts always sum to the full fee.
 */
export function fixedFeeShares(feeKobo: number, periods: OwnershipPeriod[], period: IsoDate): { ownerId: string | null; days: number; amountKobo: number }[] {
  assertKobo(feeKobo);
  const days = eachNight(period, nextMonth(period));
  const counts = new Map<string | null, number>();
  for (const d of days) {
    const owner = ownerOn(periods, d).ownerId;
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  const shares = [...counts].map(([ownerId, n]) => ({ ownerId, days: n, amountKobo: Math.floor((feeKobo * n) / days.length), rem: (feeKobo * n) % days.length }));
  let spare = feeKobo - shares.reduce((t, x) => t + x.amountKobo, 0);
  for (const s of [...shares].sort((a, b) => b.rem - a.rem)) {
    if (spare-- <= 0) break;
    s.amountKobo += 1;
  }
  return shares.map(({ ownerId, days: n, amountKobo }) => ({ ownerId, days: n, amountKobo }));
}

/** Fee is rounded per unit; a loss-making unit pays no percentage fee, the fixed fee is prorated by days owned (D-024). */
function unitFee(fee: FeeConfig, grossKobo: number, expensesKobo: number): number {
  if (fee.feeType === 'pct_gross') return pctOfBps(Math.max(0, grossKobo), fee.feeBps);
  if (fee.feeType === 'pct_net') return pctOfBps(Math.max(0, grossKobo - expensesKobo), fee.feeBps);
  return 0;
}

const ownerShare = (shares: ReturnType<typeof fixedFeeShares>, ownerId: string) => shares.find((x) => x.ownerId === ownerId)?.amountKobo ?? 0;

export function computeStatement(i: StatementInput): StatementFigures {
  assertPeriod(i.period);
  const owns = (unitId: string, date: IsoDate) => ownerOn(i.ownership[unitId] ?? [], date).ownerId === i.ownerId;
  const units: StatementUnit[] = [];
  const expenses: StatementExpense[] = [];
  for (const u of i.units) {
    if (!ownedDuring(i.ownership[u.unitId] ?? [], i.ownerId, i.period)) continue;
    const lines = i.revenue.filter((r) => r.unitId === u.unitId && inMonth(r.date, i.period) && owns(u.unitId, r.date))
      .map((r) => ({ date: r.date, ref: r.ref, source: r.source, amountKobo: r.amountKobo }));
    const ex = i.expenses.filter((e) => e.unitId === u.unitId && inMonth(e.date, i.period) && owns(u.unitId, e.date));
    const grossKobo = sumKobo(lines.map((l) => l.amountKobo));
    const expensesKobo = sumKobo(ex.map((e) => e.amountKobo));
    units.push({
      unitId: u.unitId, unitName: u.unitName, propertyName: u.propertyName, feeLabel: feeLabel(u.fee),
      grossKobo, expensesKobo, feeKobo: unitFee(u.fee, grossKobo, expensesKobo), fixedFeeKobo: ownerShare(fixedFeeShares(u.fee.feeFixedMonthlyKobo, i.ownership[u.unitId] ?? [], i.period), i.ownerId), lines,
    });
    for (const e of ex) expenses.push({ date: e.date, unitName: u.unitName, category: e.category, description: e.description, amountKobo: e.amountKobo });
  }
  const grossKobo = sumKobo(units.map((u) => u.grossKobo));
  const expensesKobo = sumKobo(units.map((u) => u.expensesKobo));
  const feeKobo = sumKobo(units.map((u) => u.feeKobo));
  const fixedFeeKobo = sumKobo(units.map((u) => u.fixedFeeKobo));
  return {
    period: i.period, units, expenses: expenses.sort((a, b) => a.date.localeCompare(b.date)), openingBalanceKobo: i.openingBalanceKobo,
    grossKobo, expensesKobo, feeKobo, fixedFeeKobo,
    netPayoutKobo: sumKobo([grossKobo, -expensesKobo, -feeKobo, -fixedFeeKobo, i.openingBalanceKobo]),
    outstanding: i.outstanding,
  };
}
