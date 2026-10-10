# M7 — Owners, Expenses & Statements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Claim each task in `docs/COORDINATION.md` before starting.

**Goal:** Expenses (with receipt photos and property-level allocation), monthly owner statements computed from per-night revenue and effective-dated ownership, a draft → finalised (immutable snapshot + PDF) → paid lifecycle, an automatic monthly run, and a read-only owner portal. Exit: E2E-06 passes; reconciliation test proves Σ owner gross + operator-owned gross = total recognised revenue.

**Architecture:** All money maths is pure and lives in `packages/shared/src/domain/{revenue,allocation,statement}.ts`. `StatementInputsLoader` gathers bookings, ledgers, ownership periods, allocations and fee configs inside `OrgDb.run`, then calls `computeStatement()`. Finalising stores the `figures` JSON snapshot and a PDF (via M3's `renderPdf` + M1's `FilesService.storeGenerated`); a DB trigger blocks changes to non-draft statements except the `paid` transition. The owner portal reads only units whose ownership period belongs to the signed-in landlord.

**Tech Stack:** as M6.

**Spec:** FRD OWN-01..09; decisions D-007 (fee config), D-014/D-015 (owner per unit), D-016 (allocation), D-017 (accrual per night).

**Depends on:** M3 (ledger), M1 (ownership, files). Independent of M4–M6.

## Global Constraints

- Revenue lines: `accommodation`, `fee`, `adjustment` (never `deposit`). Statuses that earn stay revenue: `confirmed`, `checked_in`, `checked_out`, `no_show`. `tentative` earns nothing.
- `per_night` lines are split evenly across the stay's nights; the remainder kobo (positive or negative) goes to the **first** night. `on_check_in` lines land on the check-in night.
- Cancelled bookings: `retained = paid − refunded` is recognised on the cancellation date (operator tz). Withheld deposits are recognised on their `received_on` date as damage recovery.
- Each revenue night/expense date is attributed to the owner **effective on that date** (`ownerOn`).
- Fee: computed per unit, rounded half-up per unit; `pct_gross` = bps × unit gross; `pct_net` = bps × max(0, unit gross − unit expenses); fixed monthly fee charged once per unit for any month in which the owner owned the unit at least one day. Fee config used is the unit's **current** effective config (historic fee changes are out of scope for v1 — documented).
- Opening balance: the previous finalised statement's `net_payout_kobo` if negative, else 0.
- Statement number: `<statementPrefix>-S-<YYYY>-<MM>-<seq 3>`; seq from `org_counter('statement')`.
- Months locked: once any statement for month M is finalised, expenses dated in M for units in that statement cannot be edited or deleted (422) — corrections are entered in a later month.

## Review Focus

1. **Stay spanning two months** — nights split across both statements and sum to the booking total exactly (T-M7-01 test `cross-month stay reconciles to the kobo`).
2. **Ownership changes mid-stay** — nights before the change go to the old owner, after to the new one (T-M7-01 test `mid-stay ownership change splits revenue`).
3. **Discount bigger than fees making a negative per-night remainder** — still sums exactly (T-M7-01 test `negative adjustment remainder`).
4. **Net fee on a loss-making month** — `pct_net` fee is ₦0 and payout negative, carried forward next month (T-M7-01 test `pct_net never negative; negative payout carries forward`).
5. **Finalised statement edited directly in SQL by the app role** → refused by trigger (T-M7-06 test `finalised statement is immutable`).

## Parallel split

| Task | Track | Agent | Depends on |
|---|---|---|---|
| T-M7-01 Revenue, allocation, statement maths | domain | Claude Code | M3 |
| T-M7-02 Contracts | domain | Claude Code | T-M7-01 |
| T-M7-03 Schema + immutability trigger | schema | Claude Code | T-M7-02 |
| T-M7-04 Expenses API | api | Claude Code | T-M7-03 |
| T-M7-05 Statement generation + reconciliation | api | Claude Code | T-M7-04 |
| T-M7-06 Finalise (PDF), paid, monthly job, month lock | api | Claude Code | T-M7-05 |
| T-M7-07 Owner portal API | api | Claude Code | T-M7-06 |
| T-M7-08 Expenses + statements UI | ui | OpenCode | T-M7-02 (stub), merge after T-M7-06 |
| T-M7-09 Owner portal UI + E2E-06 | ui/e2e | OpenCode | T-M7-07, T-M7-08 |

---

### Task 1 (T-M7-01) [domain]: Revenue recognition, allocation, statement computation

**Files:** Create `packages/shared/src/domain/{revenue.ts,allocation.ts,statement.ts}`; Test `packages/shared/src/domain/{revenue.test.ts,allocation.test.ts,statement.test.ts}`.

**Interfaces (produced):**
```ts
// revenue.ts
export interface RevenueLine { kind: LineKind; amountKobo: number; recognition: Recognition }
export interface RevenueBooking { id: string; ref: string; unitId: string; status: BookingStatus; checkIn: IsoDate; checkOut: IsoDate; lines: RevenueLine[]; cancelledOn: IsoDate | null; retainedKobo: number }
export interface WithheldDeposit { bookingId: string; ref: string; unitId: string; date: IsoDate; amountKobo: number }
export interface RevenueEntry { unitId: string; date: IsoDate; amountKobo: number; bookingId: string; ref: string; source: 'stay' | 'cancellation' | 'damage' }
export function recognise(bookings: RevenueBooking[], withheld: WithheldDeposit[]): RevenueEntry[]
export function inMonth(date: IsoDate, period: IsoDate): boolean
// allocation.ts
export function allocate(amountKobo: number, units: { unitId: string; sortOrder: number }[], method: 'equal' | 'custom', customBps?: Record<string, number>): { unitId: string; shareBps: number; amountKobo: number }[]
// statement.ts
export interface StatementInput { ownerId: string; period: IsoDate; units: { unitId: string; unitName: string; propertyName: string; fee: FeeConfig }[]; ownership: Record<string, OwnershipPeriod[]>; revenue: RevenueEntry[]; expenses: { expenseId: string; unitId: string; date: IsoDate; category: string; description: string; amountKobo: number }[]; openingBalanceKobo: number; outstanding: { ref: string; guestName: string; balanceKobo: number }[] }
export interface StatementFigures { period: IsoDate; units: StatementUnit[]; expenses: StatementExpense[]; openingBalanceKobo: number; grossKobo: number; expensesKobo: number; feeKobo: number; fixedFeeKobo: number; netPayoutKobo: number; outstanding: StatementInput['outstanding'] }
export interface StatementUnit { unitId; unitName; propertyName; feeLabel: string; grossKobo; expensesKobo; feeKobo; fixedFeeKobo; lines: { date: IsoDate; ref: string; source: RevenueEntry['source']; amountKobo: number }[] }
export interface StatementExpense { date; unitName; category; description; amountKobo }
export function computeStatement(i: StatementInput): StatementFigures
export function ownedDuring(periods: OwnershipPeriod[], ownerId: string, period: IsoDate): boolean
```

- [ ] **Step 1: Failing tests**

`packages/shared/src/domain/revenue.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { sumKobo } from './money';
import { inMonth, recognise, type RevenueBooking } from './revenue';

const stay = (o: Partial<RevenueBooking> = {}): RevenueBooking => ({
  id: 'b1', ref: 'R1', unitId: 'u1', status: 'checked_out', checkIn: '2026-10-30', checkOut: '2026-11-02',
  lines: [
    { kind: 'accommodation', amountKobo: 60_000_000, recognition: 'per_night' },
    { kind: 'fee', amountKobo: 1_500_000, recognition: 'on_check_in' },
    { kind: 'deposit', amountKobo: 10_000_000, recognition: 'on_check_in' },
  ],
  cancelledOn: null, retainedKobo: 0, ...o,
});

describe('recognise [OWN-03]', () => {
  it('cross-month stay reconciles to the kobo', () => {
    const e = recognise([stay()], []);
    expect(e.map((x) => [x.date, x.amountKobo])).toEqual([['2026-10-30', 21_500_000], ['2026-10-31', 20_000_000], ['2026-11-01', 20_000_000]]);
    expect(sumKobo(e.filter((x) => inMonth(x.date, '2026-10-01')).map((x) => x.amountKobo))).toBe(41_500_000);
    expect(sumKobo(e.map((x) => x.amountKobo))).toBe(61_500_000); // deposit excluded
  });
  it('puts the remainder on the first night', () => {
    const e = recognise([stay({ lines: [{ kind: 'accommodation', amountKobo: 100, recognition: 'per_night' }] })], []);
    expect(e.map((x) => x.amountKobo)).toEqual([34, 33, 33]);
  });
  it('negative adjustment remainder', () => {
    const e = recognise([stay({ lines: [{ kind: 'accommodation', amountKobo: 90, recognition: 'per_night' }, { kind: 'adjustment', amountKobo: -100, recognition: 'per_night' }] })], []);
    expect(sumKobo(e.map((x) => x.amountKobo))).toBe(-10);
    expect(e.map((x) => x.amountKobo)).toEqual([-4, -3, -3]);
  });
  it('tentative earns nothing; cancelled earns retained on cancel date; withheld deposit is damage', () => {
    const e = recognise([
      stay({ id: 't', status: 'tentative' }),
      stay({ id: 'c', ref: 'RC', status: 'cancelled', cancelledOn: '2026-10-15', retainedKobo: 10_000_000 }),
    ], [{ bookingId: 'b1', ref: 'R1', unitId: 'u1', date: '2026-11-03', amountKobo: 2_000_000 }]);
    expect(e).toEqual([
      { unitId: 'u1', date: '2026-10-15', amountKobo: 10_000_000, bookingId: 'c', ref: 'RC', source: 'cancellation' },
      { unitId: 'u1', date: '2026-11-03', amountKobo: 2_000_000, bookingId: 'b1', ref: 'R1', source: 'damage' },
    ]);
  });
  it('cancelled with nothing retained produces no entry', () => {
    expect(recognise([stay({ status: 'cancelled', cancelledOn: '2026-10-15', retainedKobo: 0 })], [])).toEqual([]);
  });
});
```
`packages/shared/src/domain/allocation.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { allocate } from './allocation';

const units = [{ unitId: 'b', sortOrder: 2 }, { unitId: 'a', sortOrder: 1 }, { unitId: 'c', sortOrder: 3 }];
describe('allocate [OWN-02]', () => {
  it('splits equally with the remainder to the first unit by sort order', () => {
    expect(allocate(1000, units, 'equal')).toEqual([
      { unitId: 'a', shareBps: 3334, amountKobo: 334 }, { unitId: 'b', shareBps: 3333, amountKobo: 333 }, { unitId: 'c', shareBps: 3333, amountKobo: 333 },
    ]);
  });
  it('custom shares must sum to 100%', () => {
    expect(() => allocate(1000, units, 'custom', { a: 5000, b: 3000, c: 1000 })).toThrow('Shares must add up to 100%');
    expect(allocate(1001, units, 'custom', { a: 5000, b: 3000, c: 2000 })).toEqual([
      { unitId: 'a', shareBps: 5000, amountKobo: 501 }, { unitId: 'b', shareBps: 3000, amountKobo: 300 }, { unitId: 'c', shareBps: 2000, amountKobo: 200 },
    ]);
  });
  it('always sums to the expense amount', () => {
    for (const amt of [1, 7, 999_999, 12_345_678]) expect(allocate(amt, units, 'equal').reduce((s, x) => s + x.amountKobo, 0)).toBe(amt);
  });
});
```
`packages/shared/src/domain/statement.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { computeStatement, type StatementInput } from './statement';

const base = (o: Partial<StatementInput> = {}): StatementInput => ({
  ownerId: 'o1', period: '2026-10-01',
  units: [{ unitId: 'u1', unitName: 'Kairo', propertyName: 'Rock', fee: { feeType: 'pct_gross', feeBps: 2000, feeFixedMonthlyKobo: 0 } }],
  ownership: { u1: [{ ownerId: 'o1', from: '2026-01-01', to: null }] },
  revenue: [
    { unitId: 'u1', date: '2026-10-10', amountKobo: 20_000_000, bookingId: 'b', ref: 'R', source: 'stay' },
    { unitId: 'u1', date: '2026-10-11', amountKobo: 20_000_000, bookingId: 'b', ref: 'R', source: 'stay' },
    { unitId: 'u1', date: '2026-11-01', amountKobo: 20_000_000, bookingId: 'b2', ref: 'R2', source: 'stay' },
  ],
  expenses: [{ expenseId: 'e', unitId: 'u1', date: '2026-10-12', category: 'cleaning', description: 'Deep clean', amountKobo: 5_000_000 }],
  openingBalanceKobo: 0, outstanding: [], ...o,
});

describe('computeStatement [OWN-04]', () => {
  it('pct_gross: fee on gross, expenses deducted', () => {
    const s = computeStatement(base());
    expect(s).toMatchObject({ grossKobo: 40_000_000, expensesKobo: 5_000_000, feeKobo: 8_000_000, fixedFeeKobo: 0, netPayoutKobo: 27_000_000 });
    expect(s.units[0]!.lines).toHaveLength(2);
    expect(s.units[0]!.feeLabel).toBe('20% of gross');
  });
  it('pct_net never negative; negative payout carries forward', () => {
    const s = computeStatement(base({
      units: [{ unitId: 'u1', unitName: 'Kairo', propertyName: 'Rock', fee: { feeType: 'pct_net', feeBps: 2000, feeFixedMonthlyKobo: 1_000_000 } }],
      expenses: [{ expenseId: 'e', unitId: 'u1', date: '2026-10-12', category: 'repairs', description: 'Inverter', amountKobo: 50_000_000 }],
      openingBalanceKobo: -3_000_000,
    }));
    expect(s).toMatchObject({ feeKobo: 0, fixedFeeKobo: 1_000_000, netPayoutKobo: 40_000_000 - 50_000_000 - 1_000_000 - 3_000_000 });
  });
  it('mid-stay ownership change splits revenue', () => {
    const input = base({ ownership: { u1: [{ ownerId: 'o0', from: '2026-01-01', to: '2026-10-11' }, { ownerId: 'o1', from: '2026-10-11', to: null }] } });
    const s = computeStatement(input);
    expect(s.grossKobo).toBe(20_000_000);
    expect(computeStatement({ ...input, ownerId: 'o0' }).grossKobo).toBe(20_000_000);
  });
  it('expense only counts if the owner owned the unit on that date', () => {
    const s = computeStatement(base({ ownership: { u1: [{ ownerId: 'o0', from: '2026-01-01', to: '2026-10-13' }, { ownerId: 'o1', from: '2026-10-13', to: null }] } }));
    expect(s.expensesKobo).toBe(0);
  });
  it('rounds fee half-up per unit', () => {
    const s = computeStatement(base({ revenue: [{ unitId: 'u1', date: '2026-10-10', amountKobo: 333, bookingId: 'b', ref: 'R', source: 'stay' }], expenses: [], units: [{ unitId: 'u1', unitName: 'K', propertyName: 'P', fee: { feeType: 'pct_gross', feeBps: 5000, feeFixedMonthlyKobo: 0 } }] }));
    expect(s.feeKobo).toBe(167);
  });
});
```
- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Implement**

`revenue.ts`:
```ts
import type { BookingStatus } from '../contracts/calendar';
import { eachNight, type IsoDate } from './dates';
import type { LineKind, Recognition } from './pricing';

export interface RevenueLine { kind: LineKind; amountKobo: number; recognition: Recognition }
export interface RevenueBooking { id: string; ref: string; unitId: string; status: BookingStatus; checkIn: IsoDate; checkOut: IsoDate; lines: RevenueLine[]; cancelledOn: IsoDate | null; retainedKobo: number }
export interface WithheldDeposit { bookingId: string; ref: string; unitId: string; date: IsoDate; amountKobo: number }
export interface RevenueEntry { unitId: string; date: IsoDate; amountKobo: number; bookingId: string; ref: string; source: 'stay' | 'cancellation' | 'damage' }

const EARNING: BookingStatus[] = ['confirmed', 'checked_in', 'checked_out', 'no_show'];
export const inMonth = (date: IsoDate, period: IsoDate) => date.slice(0, 7) === period.slice(0, 7);

export function recognise(bookings: RevenueBooking[], withheld: WithheldDeposit[]): RevenueEntry[] {
  const out: RevenueEntry[] = [];
  for (const b of bookings) {
    if (b.status === 'cancelled') {
      if (b.cancelledOn && b.retainedKobo !== 0) out.push({ unitId: b.unitId, date: b.cancelledOn, amountKobo: b.retainedKobo, bookingId: b.id, ref: b.ref, source: 'cancellation' });
      continue;
    }
    if (!EARNING.includes(b.status)) continue;
    const nights = eachNight(b.checkIn, b.checkOut);
    const perNight = new Array<number>(nights.length).fill(0);
    for (const l of b.lines) {
      if (l.kind === 'deposit') continue;
      if (l.recognition === 'on_check_in') { perNight[0]! += l.amountKobo; continue; }
      const base = Math.trunc(l.amountKobo / nights.length);
      const rem = l.amountKobo - base * nights.length;
      nights.forEach((_, i) => { perNight[i]! += base + (i === 0 ? rem : 0); });
    }
    nights.forEach((d, i) => { if (perNight[i] !== 0) out.push({ unitId: b.unitId, date: d, amountKobo: perNight[i]!, bookingId: b.id, ref: b.ref, source: 'stay' }); });
  }
  for (const w of withheld) out.push({ unitId: w.unitId, date: w.date, amountKobo: w.amountKobo, bookingId: w.bookingId, ref: w.ref, source: 'damage' });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.bookingId.localeCompare(b.bookingId));
}
```
`allocation.ts`:
```ts
export function allocate(amountKobo: number, units: { unitId: string; sortOrder: number }[], method: 'equal' | 'custom', customBps?: Record<string, number>) {
  if (!units.length) throw new Error('Choose at least one unit');
  const sorted = [...units].sort((a, b) => a.sortOrder - b.sortOrder || a.unitId.localeCompare(b.unitId));
  let shares: number[];
  if (method === 'equal') {
    const base = Math.floor(10_000 / sorted.length);
    shares = sorted.map((_, i) => base + (i === 0 ? 10_000 - base * sorted.length : 0));
  } else {
    shares = sorted.map((u) => customBps?.[u.unitId] ?? 0);
    if (shares.reduce((s, x) => s + x, 0) !== 10_000) throw new Error('Shares must add up to 100%');
  }
  const amounts = method === 'equal'
    ? sorted.map(() => Math.floor(amountKobo / sorted.length))
    : shares.map((bps) => Math.floor((amountKobo * bps) / 10_000));
  amounts[0]! += amountKobo - amounts.reduce((s, x) => s + x, 0);
  return sorted.map((u, i) => ({ unitId: u.unitId, shareBps: shares[i]!, amountKobo: amounts[i]! }));
}
```
`statement.ts`:
```ts
import type { FeeConfig } from '../contracts/inventory';
import type { IsoDate } from './dates';
import { formatNaira, pctOfBps, sumKobo } from './money';
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

const monthEnd = (period: IsoDate) => { const [y, m] = period.split('-').map(Number); return `${m === 12 ? y! + 1 : y}-${String(m === 12 ? 1 : m! + 1).padStart(2, '0')}-01`; };
export function ownedDuring(periods: OwnershipPeriod[], ownerId: string, period: IsoDate): boolean {
  const end = monthEnd(period);
  return periods.some((p) => p.ownerId === ownerId && p.from < end && (p.to === null || p.to > period));
}
export const feeLabel = (f: FeeConfig) => {
  const pct = `${f.feeBps / 100}%`;
  const base = f.feeType === 'pct_gross' ? `${pct} of gross` : f.feeType === 'pct_net' ? `${pct} of net` : 'No commission';
  return f.feeFixedMonthlyKobo ? `${base} + ${formatNaira(f.feeFixedMonthlyKobo)}/month` : base;
};

export function computeStatement(i: StatementInput): StatementFigures {
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
    const feeKobo = u.fee.feeType === 'pct_gross' ? pctOfBps(grossKobo, u.fee.feeBps)
      : u.fee.feeType === 'pct_net' ? pctOfBps(Math.max(0, grossKobo - expensesKobo), u.fee.feeBps) : 0;
    units.push({ unitId: u.unitId, unitName: u.unitName, propertyName: u.propertyName, feeLabel: feeLabel(u.fee), grossKobo, expensesKobo, feeKobo: Math.max(0, feeKobo), fixedFeeKobo: u.fee.feeFixedMonthlyKobo, lines });
    for (const e of ex) expenses.push({ date: e.date, unitName: u.unitName, category: e.category, description: e.description, amountKobo: e.amountKobo });
  }
  const grossKobo = sumKobo(units.map((u) => u.grossKobo));
  const expensesKobo = sumKobo(units.map((u) => u.expensesKobo));
  const feeKobo = sumKobo(units.map((u) => u.feeKobo));
  const fixedFeeKobo = sumKobo(units.map((u) => u.fixedFeeKobo));
  return {
    period: i.period, units, expenses: expenses.sort((a, b) => a.date.localeCompare(b.date)), openingBalanceKobo: i.openingBalanceKobo,
    grossKobo, expensesKobo, feeKobo, fixedFeeKobo,
    netPayoutKobo: grossKobo - expensesKobo - feeKobo - fixedFeeKobo + i.openingBalanceKobo,
    outstanding: i.outstanding,
  };
}
```

Export all three from `index.ts`.

- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -m "feat(shared): per-night revenue recognition, expense allocation and owner statement maths [OWN-02 OWN-03 OWN-04]"`

---

### Task 2 (T-M7-02) [domain]: Expense, statement and portal contracts

**Files:** Create `packages/shared/src/contracts/{expenses.ts,statements.ts,portal.ts}`; modify `index.ts`.

**Interfaces (produced):**
```ts
ExpenseCategory = 'cleaning'|'repairs'|'utilities'|'diesel'|'estate_dues'|'supplies'|'internet'|'other'; EXPENSE_CATEGORY_LABELS
ExpenseInput { incurredOn; propertyId; unitId: string|null; category; amountKobo (>0); description (2..300); chargeToOwner: boolean; receiptFileId?: string|null; allocation?: { method: 'equal'|'custom'; unitIds: string[]; customBps?: Record<string, number> } }   // allocation required iff unitId null
Expense { id; incurredOn; property: { id; name }; unit: { id; name } | null; category; amountKobo; description; chargeToOwner; receiptFileId: string|null; allocations: { unitId; unitName; shareBps; amountKobo }[]; locked: boolean; createdAt }
ExpenseListQuery { from; to; propertyId?; category? }
StatementStatus = 'draft'|'finalised'|'paid'
StatementSummary { id; number: string|null; owner: { id; name }; period; status; grossKobo; expensesKobo; feeKobo; fixedFeeKobo; openingBalanceKobo; netPayoutKobo; finalisedAt: string|null; paidOn: string|null; payoutReference: string|null }
StatementDetail = StatementSummary & { figures: StatementFiguresSchema }
GenerateStatementsInput { period: IsoDate (first of month, not in the future) }
MarkPaidInput { paidOn: IsoDate; payoutReference: string (2..120) }
PortalSummary { owner: { id; name }; month: IsoDate; units: { id; name; propertyName; occupancyPct: number; revenueMtdKobo: number }[]; upcoming: { unitName; checkIn; checkOut; nights; guestName: string|null }[]; statements: StatementSummary[] }
```

- [ ] **Step 1: Implement** (full code):
```ts
// expenses.ts
import { z } from 'zod';
import { IsoDateSchema, Kobo } from './common';
export const ExpenseCategory = z.enum(['cleaning', 'repairs', 'utilities', 'diesel', 'estate_dues', 'supplies', 'internet', 'other']);
export const EXPENSE_CATEGORY_LABELS: Record<z.infer<typeof ExpenseCategory>, string> = { cleaning: 'Cleaning', repairs: 'Repairs', utilities: 'Electricity & water', diesel: 'Diesel / generator', estate_dues: 'Estate dues', supplies: 'Supplies', internet: 'Internet', other: 'Other' };
export const ExpenseInput = z.object({
  incurredOn: IsoDateSchema, propertyId: z.string(), unitId: z.string().nullable(), category: ExpenseCategory,
  amountKobo: Kobo.refine((v) => v > 0, 'Amount must be more than ₦0'), description: z.string().trim().min(2).max(300),
  chargeToOwner: z.boolean(), receiptFileId: z.string().nullable().optional(),
  allocation: z.object({ method: z.enum(['equal', 'custom']), unitIds: z.array(z.string()).min(1), customBps: z.record(z.string(), z.number().int().min(0).max(10_000)).optional() }).optional(),
}).refine((e) => (e.unitId === null) === !!e.allocation, { path: ['allocation'], message: 'Choose which units share a property-wide expense' });
export type ExpenseInput = z.infer<typeof ExpenseInput>;
export const Expense = z.object({
  id: z.string(), incurredOn: z.string(), property: z.object({ id: z.string(), name: z.string() }), unit: z.object({ id: z.string(), name: z.string() }).nullable(),
  category: ExpenseCategory, amountKobo: z.number().int(), description: z.string(), chargeToOwner: z.boolean(), receiptFileId: z.string().nullable(),
  allocations: z.array(z.object({ unitId: z.string(), unitName: z.string(), shareBps: z.number().int(), amountKobo: z.number().int() })),
  locked: z.boolean(), createdAt: z.string(),
});
export type Expense = z.infer<typeof Expense>;
export const ExpenseListQuery = z.object({ from: IsoDateSchema, to: IsoDateSchema, propertyId: z.string().optional(), category: ExpenseCategory.optional() });

// statements.ts
import { z } from 'zod';
import { IsoDateSchema } from './common';
const K = z.number().int();
export const StatementFiguresSchema = z.object({
  period: z.string(),
  units: z.array(z.object({ unitId: z.string(), unitName: z.string(), propertyName: z.string(), feeLabel: z.string(), grossKobo: K, expensesKobo: K, feeKobo: K, fixedFeeKobo: K,
    lines: z.array(z.object({ date: z.string(), ref: z.string(), source: z.enum(['stay', 'cancellation', 'damage']), amountKobo: K })) })),
  expenses: z.array(z.object({ date: z.string(), unitName: z.string(), category: z.string(), description: z.string(), amountKobo: K })),
  openingBalanceKobo: K, grossKobo: K, expensesKobo: K, feeKobo: K, fixedFeeKobo: K, netPayoutKobo: K,
  outstanding: z.array(z.object({ ref: z.string(), guestName: z.string(), balanceKobo: K })),
});
export const StatementStatus = z.enum(['draft', 'finalised', 'paid']);
export const StatementSummary = z.object({
  id: z.string(), number: z.string().nullable(), owner: z.object({ id: z.string(), name: z.string() }), period: z.string(), status: StatementStatus,
  grossKobo: K, expensesKobo: K, feeKobo: K, fixedFeeKobo: K, openingBalanceKobo: K, netPayoutKobo: K,
  finalisedAt: z.string().nullable(), paidOn: z.string().nullable(), payoutReference: z.string().nullable(),
});
export type StatementSummary = z.infer<typeof StatementSummary>;
export const StatementDetail = StatementSummary.extend({ figures: StatementFiguresSchema });
export type StatementDetail = z.infer<typeof StatementDetail>;
export const GenerateStatementsInput = z.object({ period: IsoDateSchema.refine((d) => d.endsWith('-01'), 'Use the first day of the month') });
export const MarkPaidInput = z.object({ paidOn: IsoDateSchema, payoutReference: z.string().trim().min(2).max(120) });

// portal.ts
import { z } from 'zod';
import { StatementSummary } from './statements';
export const PortalSummary = z.object({
  owner: z.object({ id: z.string(), name: z.string() }), month: z.string(),
  units: z.array(z.object({ id: z.string(), name: z.string(), propertyName: z.string(), occupancyPct: z.number(), revenueMtdKobo: z.number().int() })),
  upcoming: z.array(z.object({ unitName: z.string(), checkIn: z.string(), checkOut: z.string(), nights: z.number().int(), guestName: z.string().nullable() })),
  statements: z.array(StatementSummary),
});
export type PortalSummary = z.infer<typeof PortalSummary>;
```
- [ ] **Step 2:** `pnpm --filter @boogbe/shared typecheck` → OK. **Commit** `git commit -m "feat(shared): expense, statement and owner portal contracts [OWN-01 OWN-04 OWN-08]"`

---

### Task 3 (T-M7-03) [schema]: Expenses, allocations, statements, immutability trigger

- [ ] **Step 1: Schema**
```prisma
model Expense {
  id                 String              @id
  orgId              String              @map("org_id")
  propertyId         String              @map("property_id")
  unitId             String?             @map("unit_id")
  incurredOn         DateTime            @db.Date @map("incurred_on")
  category           String
  amountKobo         BigInt              @map("amount_kobo")
  description        String
  receiptFileId      String?             @map("receipt_file_id")
  chargeToOwner      Boolean             @map("charge_to_owner")
  allocationMethod   String              @map("allocation_method")
  recordedByMemberId String?             @map("recorded_by_member_id")
  createdAt          DateTime            @default(now()) @map("created_at")
  updatedAt          DateTime            @updatedAt @map("updated_at")
  allocations        ExpenseAllocation[]

  @@index([orgId, incurredOn])
  @@map("expense")
}

model ExpenseAllocation {
  id         String  @id
  orgId      String  @map("org_id")
  expenseId  String  @map("expense_id")
  expense    Expense @relation(fields: [expenseId], references: [id], onDelete: Cascade)
  unitId     String  @map("unit_id")
  shareBps   Int     @map("share_bps")
  amountKobo BigInt  @map("amount_kobo")

  @@index([orgId, unitId])
  @@map("expense_allocation")
}

model Statement {
  id                  String    @id
  orgId               String    @map("org_id")
  number              String?
  ownerId             String    @map("owner_id")
  period              DateTime  @db.Date
  status              String    @default("draft")
  figures             Json
  grossKobo           BigInt    @map("gross_kobo")
  expensesKobo        BigInt    @map("expenses_kobo")
  feeKobo             BigInt    @map("fee_kobo")
  fixedFeeKobo        BigInt    @map("fixed_fee_kobo")
  openingBalanceKobo  BigInt    @map("opening_balance_kobo")
  netPayoutKobo       BigInt    @map("net_payout_kobo")
  pdfFileKey          String?   @map("pdf_file_key")
  finalisedAt         DateTime? @map("finalised_at")
  finalisedByMemberId String?   @map("finalised_by_member_id")
  paidOn              DateTime? @db.Date @map("paid_on")
  payoutReference     String?   @map("payout_reference")
  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt @map("updated_at")

  @@unique([ownerId, period])
  @@map("statement")
}
```
- [ ] **Step 2: Migration** `0010_statements` (append):
```sql
ALTER TABLE expense            ADD CONSTRAINT expense_org_fk FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE expense            ADD CONSTRAINT expense_property_fk FOREIGN KEY (property_id) REFERENCES property(id);
ALTER TABLE expense            ADD CONSTRAINT expense_unit_fk FOREIGN KEY (unit_id) REFERENCES unit(id);
ALTER TABLE expense            ADD CONSTRAINT expense_receipt_fk FOREIGN KEY (receipt_file_id) REFERENCES file(id);
ALTER TABLE expense            ADD CONSTRAINT expense_amount_chk CHECK (amount_kobo > 0);
ALTER TABLE expense            ADD CONSTRAINT expense_category_chk CHECK (category IN ('cleaning','repairs','utilities','diesel','estate_dues','supplies','internet','other'));
ALTER TABLE expense            ADD CONSTRAINT expense_alloc_chk CHECK (allocation_method IN ('direct','equal','custom'));
ALTER TABLE expense_allocation ADD CONSTRAINT expense_allocation_org_fk FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE expense_allocation ADD CONSTRAINT expense_allocation_unit_fk FOREIGN KEY (unit_id) REFERENCES unit(id);
ALTER TABLE statement          ADD CONSTRAINT statement_org_fk FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE statement          ADD CONSTRAINT statement_owner_fk FOREIGN KEY (owner_id) REFERENCES owner(id);
ALTER TABLE statement          ADD CONSTRAINT statement_status_chk CHECK (status IN ('draft','finalised','paid'));
CREATE UNIQUE INDEX statement_number ON statement (org_id, number) WHERE number IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expense','expense_allocation','statement'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

-- Finalised/paid statements are frozen; the only allowed change is finalised → paid with paid_on/payout_reference.
CREATE OR REPLACE FUNCTION statement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'statement % is %, cannot delete', OLD.id, OLD.status USING ERRCODE = 'P0001'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN RETURN NEW; END IF;
  IF OLD.status = 'finalised' AND NEW.status = 'paid'
     AND NEW.figures = OLD.figures AND NEW.net_payout_kobo = OLD.net_payout_kobo AND NEW.gross_kobo = OLD.gross_kobo
     AND NEW.number = OLD.number AND NEW.pdf_file_key = OLD.pdf_file_key AND NEW.period = OLD.period AND NEW.owner_id = OLD.owner_id THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'statement % is %, it cannot be changed', OLD.id, OLD.status USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER statement_guard BEFORE UPDATE OR DELETE ON statement FOR EACH ROW EXECUTE FUNCTION statement_guard();
```
- [ ] **Step 3:** reset + generate + `pnpm test:int` (RLS coverage) → PASS. **Commit** `git commit -m "feat(db): expenses, allocations and statements with immutability trigger [OWN-01 OWN-02 OWN-05]"`

---

### Task 4 (T-M7-04) [api]: Expenses API

**Files:** Create `apps/api/src/modules/owners/{owners-money.module.ts,expenses.controller.ts,expenses.service.ts}`; Test `apps/api/test/expenses.int.ts`.

**Interfaces:**
- `GET /v1/expenses?from&to&propertyId&category` (`expenses.read`) → `{ items: Expense[], totalKobo }`; `POST /v1/expenses` (`expenses.write`); `PATCH /v1/expenses/:id` (full `ExpenseInput`, re-allocates); `DELETE /v1/expenses/:id`.
- Direct expense (`unitId` set): one allocation row `{unitId, 10000, amount}`, `allocation_method = 'direct'`. Property-wide: `allocate()` over the chosen units (must belong to the property).
- `ExpensesService.assertMonthOpen(tx, unitIds: string[], date: IsoDate)` → 422 `INVALID_TRANSITION` "October 2026 is already finalised for an owner of these units — record the correction in a later month" if any non-draft statement exists for that month whose owner owned one of those units on `date`.
- `locked` in `Expense` = `assertMonthOpen` would throw.
- Receipt: `receiptFileId` must be a confirmed `receipt_image` file (`FilesService.assertConfirmed`).

- [ ] **Step 1: Failing test** `apps/api/test/expenses.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedProperty, seedUnit } from './helpers/inventory';

describe('expenses [OWN-01 OWN-02]', () => {
  let t: TestApp; let admin: Agent; let orgId: string; let propertyId: string; let a: string; let b: string; let c: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg()).id; propertyId = await seedProperty(orgId);
    a = await seedUnit(orgId, propertyId, { name: 'A' }); b = await seedUnit(orgId, propertyId, { name: 'B' }); c = await seedUnit(orgId, propertyId, { name: 'C' });
    admin = (await signInAs(t, 'admin', orgId)).agent;
  });

  it('records a direct unit expense', async () => {
    const e = (await admin.post('/v1/expenses').send({ incurredOn: '2026-10-05', propertyId, unitId: a, category: 'repairs', amountKobo: 1_500_000, description: 'Tap', chargeToOwner: true }).expect(201)).body;
    expect(e.allocations).toEqual([{ unitId: a, unitName: 'A', shareBps: 10000, amountKobo: 1_500_000 }]);
  });

  it('splits a property-wide diesel bill equally', async () => {
    const e = (await admin.post('/v1/expenses').send({ incurredOn: '2026-10-05', propertyId, unitId: null, category: 'diesel', amountKobo: 1000, description: 'Diesel', chargeToOwner: true, allocation: { method: 'equal', unitIds: [a, b, c] } }).expect(201)).body;
    expect(e.allocations.map((x: { amountKobo: number }) => x.amountKobo).reduce((s: number, x: number) => s + x, 0)).toBe(1000);
  });

  it('refuses allocation to a unit of another property, and missing allocation', async () => {
    const other = await seedUnit(orgId, await seedProperty(orgId, { name: 'Other' }));
    await admin.post('/v1/expenses').send({ incurredOn: '2026-10-05', propertyId, unitId: null, category: 'diesel', amountKobo: 1000, description: 'Diesel', chargeToOwner: true, allocation: { method: 'equal', unitIds: [a, other] } }).expect(400);
    await admin.post('/v1/expenses').send({ incurredOn: '2026-10-05', propertyId, unitId: null, category: 'diesel', amountKobo: 1000, description: 'Diesel', chargeToOwner: true }).expect(400);
  });

  it('frontdesk cannot see expenses', async () => {
    await (await signInAs(t, 'frontdesk', orgId)).agent.get('/v1/expenses?from=2026-10-01&to=2026-11-01').expect(403);
  });
});
```
(The month-lock behaviour is tested in T-M7-06 once statements can be finalised.)

- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `expenses.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { allocate, ownerOn, type Expense, type ExpenseInput, type IsoDate } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { FilesService } from '../../common/files/files.service';
import { AppError, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { OwnershipService } from '../inventory/ownership.service';
import { kobo } from '../inventory/mappers';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: IsoDate) => new Date(`${s}T00:00:00Z`);
const monthName = (d: IsoDate) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });

@Injectable()
export class ExpensesService {
  constructor(private readonly orgDb: OrgDb, private readonly audit: AuditService, private readonly files: FilesService, private readonly ownership: OwnershipService) {}

  async monthLocked(tx: OrgTx, unitIds: string[], date: IsoDate): Promise<boolean> {
    const period = day(`${date.slice(0, 7)}-01`);
    const closed = await tx.statement.findMany({ where: { period, status: { in: ['finalised', 'paid'] } }, select: { ownerId: true } });
    if (!closed.length) return false;
    const periods = await this.ownership.periodsFor(tx, unitIds);
    const owners = new Set(unitIds.map((u) => ownerOn(periods.get(u) ?? [], date).ownerId).filter(Boolean));
    return closed.some((s) => owners.has(s.ownerId));
  }
  async assertMonthOpen(tx: OrgTx, unitIds: string[], date: IsoDate) {
    if (await this.monthLocked(tx, unitIds, date)) throw new AppError('INVALID_TRANSITION', 422, `${monthName(date)} is already finalised for an owner of these units — record the correction in a later month`);
  }

  private async buildAllocations(tx: OrgTx, input: ExpenseInput) {
    if (input.unitId) {
      const u = await tx.unit.findFirst({ where: { id: input.unitId, propertyId: input.propertyId } });
      if (!u) throw new AppError('VALIDATION_FAILED', 400, 'Unit is not in this property');
      return { method: 'direct' as const, rows: [{ unitId: u.id, shareBps: 10_000, amountKobo: input.amountKobo }] };
    }
    const units = await tx.unit.findMany({ where: { id: { in: input.allocation!.unitIds }, propertyId: input.propertyId } });
    if (units.length !== new Set(input.allocation!.unitIds).size) throw new AppError('VALIDATION_FAILED', 400, 'Every unit must belong to this property');
    try { return { method: input.allocation!.method, rows: allocate(input.amountKobo, units.map((u) => ({ unitId: u.id, sortOrder: u.sortOrder })), input.allocation!.method, input.allocation!.customBps) }; }
    catch (e) { throw new AppError('VALIDATION_FAILED', 400, (e as Error).message); }
  }

  private async toExpense(tx: OrgTx, id: string): Promise<Expense> {
    const e = await tx.expense.findFirst({ where: { id }, include: { allocations: true } });
    if (!e) throw notFound('Expense');
    const prop = await tx.property.findFirstOrThrow({ where: { id: e.propertyId } });
    const unitIds = e.allocations.map((a) => a.unitId);
    const units = new Map((await tx.unit.findMany({ where: { id: { in: unitIds } } })).map((u) => [u.id, u.name]));
    return {
      id: e.id, incurredOn: iso(e.incurredOn), property: { id: prop.id, name: prop.name }, unit: e.unitId ? { id: e.unitId, name: units.get(e.unitId) ?? '' } : null,
      category: e.category as Expense['category'], amountKobo: kobo(e.amountKobo), description: e.description, chargeToOwner: e.chargeToOwner, receiptFileId: e.receiptFileId,
      allocations: e.allocations.map((a) => ({ unitId: a.unitId, unitName: units.get(a.unitId) ?? '', shareBps: a.shareBps, amountKobo: kobo(a.amountKobo) })),
      locked: await this.monthLocked(tx, unitIds, iso(e.incurredOn)), createdAt: e.createdAt.toISOString(),
    };
  }

  list(ctx: OrgCtx, q: { from: IsoDate; to: IsoDate; propertyId?: string; category?: string }) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const rows = await tx.expense.findMany({ where: { incurredOn: { gte: day(q.from), lt: day(q.to) }, ...(q.propertyId && { propertyId: q.propertyId }), ...(q.category && { category: q.category }) }, orderBy: [{ incurredOn: 'desc' }, { id: 'desc' }], select: { id: true, amountKobo: true } });
      const items = []; for (const r of rows) items.push(await this.toExpense(tx, r.id));
      return { items, totalKobo: rows.reduce((s, r) => s + kobo(r.amountKobo), 0) };
    });
  }

  async write(ctx: OrgCtx, input: ExpenseInput, id?: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      if (input.receiptFileId) await this.files.assertConfirmed(tx, input.receiptFileId, 'receipt_image');
      const { method, rows } = await this.buildAllocations(tx, input);
      await this.assertMonthOpen(tx, rows.map((r) => r.unitId), input.incurredOn);
      let before: Expense | null = null;
      if (id) {
        before = await this.toExpense(tx, id);
        await this.assertMonthOpen(tx, before.allocations.map((a) => a.unitId), before.incurredOn);
        await tx.expenseAllocation.deleteMany({ where: { expenseId: id } });
        await tx.expense.updateMany({ where: { id }, data: { incurredOn: day(input.incurredOn), propertyId: input.propertyId, unitId: input.unitId, category: input.category, amountKobo: BigInt(input.amountKobo), description: input.description, chargeToOwner: input.chargeToOwner, receiptFileId: input.receiptFileId ?? null, allocationMethod: method } });
      } else {
        id = newId();
        await tx.expense.create({ data: { id, incurredOn: day(input.incurredOn), propertyId: input.propertyId, unitId: input.unitId, category: input.category, amountKobo: BigInt(input.amountKobo), description: input.description, chargeToOwner: input.chargeToOwner, receiptFileId: input.receiptFileId ?? null, allocationMethod: method, recordedByMemberId: ctx.memberId } as never });
      }
      await tx.expenseAllocation.createMany({ data: rows.map((r) => ({ id: newId(), expenseId: id!, unitId: r.unitId, shareBps: r.shareBps, amountKobo: BigInt(r.amountKobo) })) as never });
      await this.audit.record(tx, { actor: ctx, action: before ? 'expense.update' : 'expense.create', entity: 'expense', entityId: id, before, after: input });
      return this.toExpense(tx, id);
    });
  }

  remove(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const e = await this.toExpense(tx, id);
      await this.assertMonthOpen(tx, e.allocations.map((a) => a.unitId), e.incurredOn);
      await tx.expense.deleteMany({ where: { id } });
      await this.audit.record(tx, { actor: ctx, action: 'expense.delete', entity: 'expense', entityId: id, before: e });
      return { ok: true };
    });
  }
}
```
Controller: `GET /v1/expenses` (`expenses.read`, `ExpenseListQuery`), `POST` (`expenses.write`, 201), `PATCH /:id` (`expenses.write`), `DELETE /:id` (`expenses.write`). `OwnersMoneyModule` imports `InventoryModule` (for `OwnershipService`). Isolation fixture `expense` + route `/^\/v1\/expenses\//`.

- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -m "feat(expenses): unit and property-wide expenses with allocation and month locks [OWN-01 OWN-02]"`

---

### Task 5 (T-M7-05) [api]: Statement generation and reconciliation

**Files:** Create `apps/api/src/modules/owners/{statement-inputs.ts,statements.service.ts,statements.controller.ts}`; Test `apps/api/test/statements.int.ts`, `apps/api/test/statement-reconciliation.int.ts`.

**Interfaces:**
- `StatementInputsLoader.load(tx, orgId, period: IsoDate): Promise<{ revenue: RevenueEntry[]; ownership: Record<string, OwnershipPeriod[]>; units: StatementInput['units']; allocations: StatementInput['expenses'] /* chargeToOwner only */; outstandingByUnit: Map<unitId, StatementInput['outstanding']>; ownerIds: string[] }>` — bookings overlapping the month (plus cancelled-in-month), their lines and ledgers (`PaymentsService.entriesFor`), withheld deposits received in month; cancellation date = `cancelled_at` in operator tz.
- `StatementsService.generate(ctx, period)` → `{ items: StatementSummary[] }`: for every owner who owned any unit during the period, upsert a **draft** (skip owners whose statement is already finalised/paid); `figures` from `computeStatement`.
- `GET /v1/statements?period=&ownerId=&status=` (`statements.read`) → `{ items: StatementSummary[] }`; `GET /v1/statements/:id` → `StatementDetail`; `POST /v1/statements/generate` (`statements.write`) `GenerateStatementsInput`; `POST /v1/statements/:id/regenerate` (`statements.write`, draft only).
- `StatementsService.revenueForOrg(tx, orgId, period)` — test hook returning Σ recognised revenue in the period (all units) for the reconciliation test.

- [ ] **Step 1: Failing tests**

`apps/api/test/statements.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedBooking, seedGuest, seedOwner, seedProperty, seedUnit } from './helpers/inventory';

describe('statements [OWN-04 OWN-07 OWN-09]', () => {
  let t: TestApp; let admin: Agent; let orgId: string; let owner: string; let unitId: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg()).id;
    const m = await migratorClient();
    await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'TAN','TAN','TAN',now())`, [orgId]);
    await m.end();
    owner = await seedOwner(orgId, { name: 'Mrs Adebayo' });
    const p = await seedProperty(orgId, { feeType: 'pct_gross', feeBps: 2000 });
    unitId = await seedUnit(orgId, p, { name: 'Kairo', ownerId: owner, from: '2026-01-01' });
    admin = (await signInAs(t, 'admin', orgId)).agent;
  });

  it('generates a draft with gross, expenses, fee and payout', async () => {
    const g = await seedGuest(orgId, { fullName: 'Ada' });
    await seedBooking(orgId, unitId, g, { checkIn: '2026-10-30', checkOut: '2026-11-02', status: 'checked_out', totalKobo: 60_000_000 });
    await admin.post('/v1/expenses').send({ incurredOn: '2026-10-31', propertyId: (await admin.get('/v1/properties').expect(200)).body.items[0].id, unitId, category: 'cleaning', amountKobo: 5_000_000, description: 'Deep clean', chargeToOwner: true }).expect(201);
    const r = (await admin.post('/v1/statements/generate').send({ period: '2026-10-01' }).expect(200)).body.items;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ owner: { name: 'Mrs Adebayo' }, status: 'draft', grossKobo: 40_000_000, expensesKobo: 5_000_000, feeKobo: 8_000_000, netPayoutKobo: 27_000_000 });
    const nov = (await admin.post('/v1/statements/generate').send({ period: '2026-11-01' }).expect(200)).body.items;
    expect(nov[0].grossKobo).toBe(20_000_000);
  });

  it('regenerating a draft picks up new data; outstanding balances are listed', async () => {
    const g = await seedGuest(orgId, { fullName: 'Ada' });
    await seedBooking(orgId, unitId, g, { checkIn: '2026-10-05', checkOut: '2026-10-07', status: 'checked_out', totalKobo: 40_000_000 });
    const s = (await admin.post('/v1/statements/generate').send({ period: '2026-10-01' }).expect(200)).body.items[0];
    const d = (await admin.get(`/v1/statements/${s.id}`).expect(200)).body;
    expect(d.figures.outstanding).toEqual([{ ref: expect.any(String), guestName: 'Ada', balanceKobo: 40_000_000 }]);
    await seedBooking(orgId, unitId, g, { checkIn: '2026-10-20', checkOut: '2026-10-21', status: 'checked_out', totalKobo: 10_000_000 });
    const r = (await admin.post(`/v1/statements/${s.id}/regenerate`).expect(200)).body;
    expect(r.grossKobo).toBe(50_000_000);
  });

  it('rejects a future month', async () => {
    await admin.post('/v1/statements/generate').send({ period: '2099-01-01' }).expect(422);
  });
});
```
`apps/api/test/statement-reconciliation.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';
import { seedBooking, seedGuest, seedOwner, seedProperty, seedUnit } from './helpers/inventory';
import { OrgDb } from '../src/common/db/org-db.service';
import { StatementsService } from '../src/modules/owners/statements.service';
import { newId } from '../src/common/db/ids';

describe('statement reconciliation [OWN-03 OWN-04]', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await truncateAll(); });

  it('Σ owner gross + operator-owned gross = total recognised revenue', async () => {
    const orgId = (await seedOrg()).id;
    const m = await migratorClient();
    await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'T','T','T',now())`, [orgId]);
    const o1 = await seedOwner(orgId, { name: 'O1' }); const o2 = await seedOwner(orgId, { name: 'O2' });
    const p = await seedProperty(orgId, { feeType: 'pct_gross', feeBps: 1500 });
    const u1 = await seedUnit(orgId, p, { name: 'U1', ownerId: o1 });
    const u2 = await seedUnit(orgId, p, { name: 'U2', ownerId: o2 });
    const u3 = await seedUnit(orgId, p, { name: 'U3', ownerId: null }); // operator-owned
    // ownership change mid-month on U2: o2 → o1 from 2026-10-15
    await m.query(`update unit_ownership set effective_to='2026-10-15' where unit_id=$1`, [u2]);
    await m.query(`insert into unit_ownership(id, org_id, unit_id, owner_id, effective_from) values ($1,$2,$3,$4,'2026-10-15')`, [newId(), orgId, u2, o1]);
    await m.end();
    const g = await seedGuest(orgId);
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (const u of [u1, u2, u3]) {
      let day = 1;
      while (day < 28) {
        const n = 1 + Math.floor(rnd() * 4);
        const ci = `2026-10-${String(day).padStart(2, '0')}`; const co = `2026-10-${String(Math.min(day + n, 31)).padStart(2, '0')}`;
        await seedBooking(orgId, u, g, { checkIn: ci, checkOut: co, status: 'checked_out', totalKobo: Math.floor(rnd() * 50_000_000) + 1 });
        day += n + 1;
      }
    }
    const admin = (await signInAs(t, 'admin', orgId)).agent;
    const items = (await admin.post('/v1/statements/generate').send({ period: '2026-10-01' }).expect(200)).body.items as { grossKobo: number }[];
    const ownersGross = items.reduce((s, x) => s + x.grossKobo, 0);
    const svc = t.app.get(StatementsService);
    const { total, operatorOwned } = await t.app.get(OrgDb).run(orgId, (tx) => svc.revenueForOrg(tx, orgId, '2026-10-01'));
    expect(ownersGross + operatorOwned).toBe(total);
    expect(total).toBeGreaterThan(0);
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement**

`statement-inputs.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { ACTIVE_STATUSES, effectiveEntries, effectiveFeeConfig, ledger, recognise, todayIn, type FeeConfig, type IsoDate, type OwnershipPeriod, type RevenueBooking, type StatementInput, type WithheldDeposit } from '@boogbe/shared';
import type { OrgTx } from '../../common/db/org-db.service';
import { OrgInfo } from '../../common/db/org-info';
import { OwnershipService } from '../inventory/ownership.service';
import { kobo } from '../inventory/mappers';
import { PaymentsService } from '../payments/payments.service';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: IsoDate) => new Date(`${s}T00:00:00Z`);
export const nextMonth = (p: IsoDate) => { const [y, m] = p.split('-').map(Number); return `${m === 12 ? y! + 1 : y}-${String(m === 12 ? 1 : m! + 1).padStart(2, '0')}-01`; };

@Injectable()
export class StatementInputsLoader {
  constructor(private readonly ownership: OwnershipService, private readonly payments: PaymentsService, private readonly orgInfo: OrgInfo) {}

  async load(tx: OrgTx, orgId: string, period: IsoDate) {
    const end = nextMonth(period);
    const { timezone } = await this.orgInfo.get(orgId);
    const units = await tx.unit.findMany({ include: { property: true } });
    const periods = await this.ownership.periodsFor(tx, units.map((u) => u.id));
    const ownership: Record<string, OwnershipPeriod[]> = Object.fromEntries(periods);

    const bookings = await tx.booking.findMany({
      where: { OR: [
        { status: { in: ['confirmed', 'checked_in', 'checked_out', 'no_show'] }, checkIn: { lt: day(end) }, checkOut: { gt: day(period) } },
        { status: 'cancelled', cancelledAt: { gte: new Date(day(period).getTime() - 86_400_000), lt: new Date(day(end).getTime() + 86_400_000) } },
      ] },
      include: { lines: true, guest: true },
    });
    const entries = await this.payments.entriesFor(tx, bookings.map((b) => b.id));
    const rb: RevenueBooking[] = bookings.map((b) => {
      const t = ledger(entries.get(b.id) ?? [], { finalTotalKobo: kobo(b.finalTotalKobo), status: b.status as never });
      return {
        id: b.id, ref: b.ref, unitId: b.unitId, status: b.status as never, checkIn: iso(b.checkIn), checkOut: iso(b.checkOut),
        lines: b.lines.map((l) => ({ kind: l.kind as never, amountKobo: kobo(l.amountKobo), recognition: l.recognition as never })),
        cancelledOn: b.cancelledAt ? todayIn(timezone, b.cancelledAt) : null, retainedKobo: t.retainedKobo,
      };
    });
    const withheldRows = await tx.payment.findMany({ where: { kind: 'deposit_withheld', receivedOn: { gte: day(period), lt: day(end) } }, include: { booking: true } });
    const allWithheldBookings = await this.payments.entriesFor(tx, withheldRows.map((w) => w.bookingId));
    const withheld: WithheldDeposit[] = withheldRows
      .filter((w) => effectiveEntries(allWithheldBookings.get(w.bookingId) ?? []).some((e) => e.id === w.id))
      .map((w) => ({ bookingId: w.bookingId, ref: w.booking.ref, unitId: w.booking.unitId, date: iso(w.receivedOn), amountKobo: kobo(w.amountKobo) }));

    const revenue = recognise(rb, withheld);
    const allocations = await tx.expenseAllocation.findMany({ where: { expense: { incurredOn: { gte: day(period), lt: day(end) }, chargeToOwner: true } }, include: { expense: true } });
    const expenses: StatementInput['expenses'] = allocations.map((a) => ({ expenseId: a.expenseId, unitId: a.unitId, date: iso(a.expense.incurredOn), category: a.expense.category, description: a.expense.description, amountKobo: kobo(a.amountKobo) }));

    const unitCfg: StatementInput['units'] = units.map((u) => ({
      unitId: u.id, unitName: u.name, propertyName: u.property.name,
      fee: effectiveFeeConfig(
        { feeType: u.property.feeType as FeeConfig['feeType'], feeBps: u.property.feeBps, feeFixedMonthlyKobo: kobo(u.property.feeFixedMonthlyKobo) },
        { feeOverride: u.feeOverride, feeType: u.feeType as FeeConfig['feeType'], feeBps: u.feeBps, feeFixedMonthlyKobo: kobo(u.feeFixedMonthlyKobo) }),
    }));

    const outstandingByUnit = new Map<string, StatementInput['outstanding']>();
    for (const b of bookings) {
      if (!ACTIVE_STATUSES.includes(b.status as never) && b.status !== 'checked_out') continue;
      const t = ledger(entries.get(b.id) ?? [], { finalTotalKobo: kobo(b.finalTotalKobo), status: b.status as never });
      if (t.balanceKobo > 0) { const list = outstandingByUnit.get(b.unitId) ?? []; list.push({ ref: b.ref, guestName: b.guest.fullName, balanceKobo: t.balanceKobo }); outstandingByUnit.set(b.unitId, list); }
    }
    const ownerIds = [...new Set(Object.values(ownership).flat().filter((p) => p.ownerId && p.from < end && (p.to === null || p.to > period)).map((p) => p.ownerId!))];
    return { revenue, ownership, units: unitCfg, expenses, outstandingByUnit, ownerIds };
  }
}
```
(The cancelled-bookings window is widened by a day on each side because `cancelled_at` is a UTC timestamp and the local cancellation date is computed afterwards; `recognise` + `inMonth` then filter exactly.)

`statements.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { computeStatement, inMonth, ownedDuring, ownerOn, sumKobo, todayIn, type IsoDate, type StatementDetail, type StatementSummary } from '@boogbe/shared';
import type { Prisma, Statement as Row } from '@prisma/client';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { kobo } from '../inventory/mappers';
import { StatementInputsLoader } from './statement-inputs';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: IsoDate) => new Date(`${s}T00:00:00Z`);

@Injectable()
export class StatementsService {
  constructor(private readonly orgDb: OrgDb, private readonly loader: StatementInputsLoader, private readonly audit: AuditService) {}

  async toSummary(tx: OrgTx, r: Row): Promise<StatementSummary> {
    const o = await tx.owner.findFirstOrThrow({ where: { id: r.ownerId } });
    return { id: r.id, number: r.number, owner: { id: o.id, name: o.name }, period: iso(r.period), status: r.status as StatementSummary['status'],
      grossKobo: kobo(r.grossKobo), expensesKobo: kobo(r.expensesKobo), feeKobo: kobo(r.feeKobo), fixedFeeKobo: kobo(r.fixedFeeKobo), openingBalanceKobo: Number(r.openingBalanceKobo), netPayoutKobo: Number(r.netPayoutKobo),
      finalisedAt: r.finalisedAt?.toISOString() ?? null, paidOn: r.paidOn ? iso(r.paidOn) : null, payoutReference: r.payoutReference };
  }

  async openingBalance(tx: OrgTx, ownerId: string, period: IsoDate) {
    const prev = await tx.statement.findFirst({ where: { ownerId, period: { lt: day(period) }, status: { in: ['finalised', 'paid'] } }, orderBy: { period: 'desc' } });
    return prev && Number(prev.netPayoutKobo) < 0 ? Number(prev.netPayoutKobo) : 0;
  }

  async generateIn(tx: OrgTx, orgId: string, period: IsoDate, onlyOwnerId?: string) {
    const data = await this.loader.load(tx, orgId, period);
    const out: StatementSummary[] = [];
    for (const ownerId of data.ownerIds.filter((o) => !onlyOwnerId || o === onlyOwnerId)) {
      const existing = await tx.statement.findFirst({ where: { ownerId, period: day(period) } });
      if (existing && existing.status !== 'draft') { out.push(await this.toSummary(tx, existing)); continue; }
      const ownedUnits = data.units.filter((u) => ownedDuring(data.ownership[u.unitId] ?? [], ownerId, period)).map((u) => u.unitId);
      const f = computeStatement({
        ownerId, period, units: data.units, ownership: data.ownership, revenue: data.revenue, expenses: data.expenses,
        openingBalanceKobo: await this.openingBalance(tx, ownerId, period),
        outstanding: ownedUnits.flatMap((u) => data.outstandingByUnit.get(u) ?? []),
      });
      const row = { figures: f as unknown as Prisma.InputJsonValue, grossKobo: BigInt(f.grossKobo), expensesKobo: BigInt(f.expensesKobo), feeKobo: BigInt(f.feeKobo), fixedFeeKobo: BigInt(f.fixedFeeKobo), openingBalanceKobo: BigInt(f.openingBalanceKobo), netPayoutKobo: BigInt(f.netPayoutKobo) };
      if (existing) await tx.statement.updateMany({ where: { id: existing.id }, data: row });
      else await tx.statement.create({ data: { id: newId(), ownerId, period: day(period), status: 'draft', ...row } as never });
      out.push(await this.toSummary(tx, (await tx.statement.findFirst({ where: { ownerId, period: day(period) } }))!));
    }
    return out;
  }

  generate(ctx: OrgCtx, period: IsoDate) {
    if (period > todayIn(ctx.timezone)) throw new AppError('INVALID_TRANSITION', 422, 'That month has not started yet');
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const items = await this.generateIn(tx, ctx.orgId, period);
      await this.audit.record(tx, { actor: ctx, action: 'statements.generate', entity: 'statement', entityId: period, after: { count: items.length } });
      return { items };
    }, { timeoutMs: 60_000 });
  }

  regenerate(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const s = await tx.statement.findFirst({ where: { id } });
      if (!s) throw notFound('Statement');
      if (s.status !== 'draft') throw new AppError('INVALID_TRANSITION', 422, 'Only drafts can be recalculated');
      await this.generateIn(tx, ctx.orgId, iso(s.period), s.ownerId);
      return this.toSummary(tx, (await tx.statement.findFirst({ where: { id } }))!);
    }, { timeoutMs: 60_000 });
  }

  list(ctx: OrgCtx, q: { period?: IsoDate; ownerId?: string; status?: string }) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const rows = await tx.statement.findMany({ where: { ...(q.period && { period: day(q.period) }), ...(q.ownerId && { ownerId: q.ownerId }), ...(q.status && { status: q.status }) }, orderBy: [{ period: 'desc' }] });
      const items = []; for (const r of rows) items.push(await this.toSummary(tx, r));
      return { items };
    });
  }

  async detailIn(tx: OrgTx, id: string, where: Prisma.StatementWhereInput = {}): Promise<StatementDetail> {
    const r = await tx.statement.findFirst({ where: { id, ...where } });
    if (!r) throw notFound('Statement');
    return { ...(await this.toSummary(tx, r)), figures: r.figures as never };
  }
  get(ctx: OrgCtx, id: string) { return this.orgDb.run(ctx.orgId, (tx) => this.detailIn(tx, id)); }

  /** Reconciliation helper (tests + M8 health check). */
  async revenueForOrg(tx: OrgTx, orgId: string, period: IsoDate) {
    const d = await this.loader.load(tx, orgId, period);
    const inPeriod = d.revenue.filter((r) => inMonth(r.date, period));
    return {
      total: sumKobo(inPeriod.map((r) => r.amountKobo)),
      operatorOwned: sumKobo(inPeriod.filter((r) => ownerOn(d.ownership[r.unitId] ?? [], r.date).ownerId === null).map((r) => r.amountKobo)),
    };
  }
}
```
Controller (`@Controller('statements')`): `GET /` (`statements.read`), `POST generate` (`statements.write`, `@HttpCode(200)`), `GET :id` (`statements.read`), `POST :id/regenerate` (`statements.write`, 200). Module provides `StatementInputsLoader`, `StatementsService`. Isolation fixture `statement` + route.

- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -m "feat(statements): draft generation from per-night revenue and effective ownership; reconciliation [OWN-03 OWN-04 OWN-07 OWN-09]"`

---

### Task 6 (T-M7-06) [api]: Finalise with PDF, mark paid, monthly job, month locks

**Files:** Create `apps/api/src/common/pdf/statement.ts`, `apps/api/src/modules/owners/{statements-monthly.job.ts,owners.crons.ts}`; modify `statements.service.ts`, `statements.controller.ts`; Test `apps/api/test/statements-lifecycle.int.ts`, `apps/api/src/common/pdf/statement.spec.ts`.

**Interfaces:**
- `renderStatement(d: { org: Brand & { logo: Buffer|null }; number: string; owner: { name; bankName; accountNumber; accountName }; figures: StatementFigures }, opts?): Promise<Buffer>` — sections: header, owner + period, per-unit table (gross, expenses, fee, fixed fee), revenue lines (date, ref, source, amount), expenses list, totals with opening balance, net payout ("Owner owes" when negative), outstanding guest balances note, bank details.
- `POST /v1/statements/:id/finalise` (`statements.write`): draft only → regenerate first (fresh figures) → number → PDF → `FilesService.storeGenerated(orgId, 'statement_pdf', pdf, memberId)` → `status='finalised'`, `pdf_file_key`, `finalised_at/by`.
- `POST /v1/statements/:id/paid` (`statements.write`) `MarkPaidInput` (finalised only).
- `GET /v1/statements/:id/pdf` (`statements.read`) → 302 to presigned URL (`FilesService.signedUrlForKey(key, '<number>.pdf')`); 404 for drafts.
- `StatementsMonthlyJob.run(now?)`: per org, at local day 1 hour 6 → `generateIn(prev month)` and notify admins `statements_ready` (`dedupeKey: statements-<period>`, email true). Cron wrapper in `OwnersCrons` (`0 * * * *`).

- [ ] **Step 1: Failing tests**

`apps/api/src/common/pdf/statement.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { renderStatement } from './statement';

describe('renderStatement [OWN-05]', () => {
  it('renders a PDF with the statement number in its metadata', async () => {
    const buf = await renderStatement({
      org: { name: 'Tanuhomes', logo: null }, number: 'TAN-S-2026-10-001',
      owner: { name: 'Mrs Adebayo', bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Adebayo F.' },
      figures: { period: '2026-10-01', units: [{ unitId: 'u', unitName: 'Kairo', propertyName: 'Rock', feeLabel: '20% of gross', grossKobo: 40_000_000, expensesKobo: 5_000_000, feeKobo: 8_000_000, fixedFeeKobo: 0, lines: [{ date: '2026-10-30', ref: 'R1', source: 'stay', amountKobo: 40_000_000 }] }],
        expenses: [{ date: '2026-10-31', unitName: 'Kairo', category: 'cleaning', description: 'Deep clean', amountKobo: 5_000_000 }],
        openingBalanceKobo: 0, grossKobo: 40_000_000, expensesKobo: 5_000_000, feeKobo: 8_000_000, fixedFeeKobo: 0, netPayoutKobo: 27_000_000, outstanding: [] },
    }, { compress: false });
    const text = buf.toString('latin1');
    expect(text.startsWith('%PDF')).toBe(true);
    expect(text).toContain('TAN-S-2026-10-001');
  });
});
```
`apps/api/test/statements-lifecycle.int.ts`:
```ts
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedBooking, seedGuest, seedOwner, seedProperty, seedUnit } from './helpers/inventory';
import { StatementsMonthlyJob } from '../src/modules/owners/statements-monthly.job';

describe('statement lifecycle [OWN-05 OWN-06]', () => {
  let t: TestApp; let admin: Agent; let orgId: string; let owner: string; let unitId: string; let propertyId: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg()).id;
    const m = await migratorClient();
    await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'TAN','TAN','TAN',now())`, [orgId]);
    await m.end();
    owner = await seedOwner(orgId, { name: 'Mrs Adebayo' });
    propertyId = await seedProperty(orgId, { feeType: 'pct_gross', feeBps: 2000 });
    unitId = await seedUnit(orgId, propertyId, { ownerId: owner });
    await seedBooking(orgId, unitId, await seedGuest(orgId), { checkIn: '2026-10-05', checkOut: '2026-10-07', status: 'checked_out', totalKobo: 40_000_000 });
    admin = (await signInAs(t, 'admin', orgId)).agent;
  });
  const draft = async () => (await admin.post('/v1/statements/generate').send({ period: '2026-10-01' }).expect(200)).body.items[0];

  it('finalise numbers it, stores a PDF and freezes it; paid records payout', async () => {
    const s = await draft();
    const f = (await admin.post(`/v1/statements/${s.id}/finalise`).expect(200)).body;
    expect(f).toMatchObject({ status: 'finalised', number: 'TAN-S-2026-10-001' });
    const pdf = await admin.get(`/v1/statements/${s.id}/pdf`).redirects(0);
    expect(pdf.status).toBe(302);
    await admin.post(`/v1/statements/${s.id}/regenerate`).expect(422);
    await admin.post(`/v1/statements/${s.id}/paid`).send({ paidOn: '2026-11-03', payoutReference: 'GTB-TRF-1' }).expect(200);
    expect((await admin.get(`/v1/statements/${s.id}`).expect(200)).body).toMatchObject({ status: 'paid', paidOn: '2026-11-03' });
  });

  it('finalised statement is immutable', async () => {
    const s = await draft();
    await admin.post(`/v1/statements/${s.id}/finalise`).expect(200);
    const c = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await c.connect();
    await c.query('begin'); await c.query(`select set_config('app.org_id',$1,true)`, [orgId]);
    await expect(c.query(`update statement set net_payout_kobo = 1 where id = $1`, [s.id])).rejects.toThrow(/cannot be changed/);
    await c.query('rollback'); await c.end();
  });

  it('locks expenses for a finalised month', async () => {
    const e = (await admin.post('/v1/expenses').send({ incurredOn: '2026-10-10', propertyId, unitId, category: 'repairs', amountKobo: 1_000_000, description: 'Tap', chargeToOwner: true }).expect(201)).body;
    const s = await draft();
    await admin.post(`/v1/statements/${s.id}/finalise`).expect(200);
    await admin.delete(`/v1/expenses/${e.id}`).expect(422);
    await admin.post('/v1/expenses').send({ incurredOn: '2026-10-11', propertyId, unitId, category: 'repairs', amountKobo: 1, description: 'Late', chargeToOwner: true }).expect(422);
    await admin.post('/v1/expenses').send({ incurredOn: '2026-11-01', propertyId, unitId, category: 'repairs', amountKobo: 1, description: 'Correction', chargeToOwner: true }).expect(201);
  });

  it('monthly job creates drafts on the 1st at 06:00 local and notifies once', async () => {
    const job = t.app.get(StatementsMonthlyJob);
    await job.run(new Date('2026-11-01T04:00:00Z')); // 05:00 Lagos
    expect((await admin.get('/v1/statements?period=2026-10-01').expect(200)).body.items).toHaveLength(0);
    await job.run(new Date('2026-11-01T05:10:00Z')); // 06:10 Lagos
    await job.run(new Date('2026-11-01T05:40:00Z'));
    expect((await admin.get('/v1/statements?period=2026-10-01').expect(200)).body.items).toHaveLength(1);
    expect((await admin.get('/v1/notifications').expect(200)).body.items.filter((n: { kind: string }) => n.kind === 'statements_ready')).toHaveLength(1);
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement**

`apps/api/src/common/pdf/statement.ts`:
```ts
import type { StatementFigures } from '@boogbe/shared';
import { renderPdf } from './pdf';
import { brandHeader, footer, naira, row, type Brand } from './layout';

const month = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const d = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const SOURCE = { stay: 'Stay', cancellation: 'Cancellation kept', damage: 'Damage from deposit' } as const;

export function renderStatement(s: { org: Brand & { logo: Buffer | null }; number: string; owner: { name: string; bankName: string | null; accountNumber: string | null; accountName: string | null }; figures: StatementFigures }, opts: { compress?: boolean } = {}) {
  const f = s.figures;
  return renderPdf((doc) => {
    brandHeader(doc, s.org);
    doc.font('bold').fontSize(18).text(`Owner statement — ${month(f.period)}`, 48);
    doc.font('body').fontSize(10).text(`${s.number}  ·  ${s.owner.name}`).moveDown();
    for (const u of f.units) {
      doc.font('bold').fontSize(12).text(`${u.unitName} (${u.propertyName})`, 48).font('body').fontSize(9).fillColor('#5b6d72').text(u.feeLabel).fillColor('#182d32');
      for (const l of u.lines) row(doc, `${d(l.date)}  ${l.ref}  ${SOURCE[l.source]}`, naira(l.amountKobo));
      row(doc, 'Income', naira(u.grossKobo), { bold: true });
      if (u.expensesKobo) row(doc, 'Expenses', `−${naira(u.expensesKobo)}`);
      if (u.feeKobo) row(doc, 'Management fee', `−${naira(u.feeKobo)}`);
      if (u.fixedFeeKobo) row(doc, 'Fixed monthly fee', `−${naira(u.fixedFeeKobo)}`);
      doc.moveDown(0.6);
      if (doc.y > 700) doc.addPage();
    }
    if (f.expenses.length) {
      doc.font('bold').fontSize(12).text('Expenses', 48);
      for (const e of f.expenses) row(doc, `${d(e.date)}  ${e.unitName}  ${e.description}`, naira(e.amountKobo));
      doc.moveDown(0.6);
    }
    doc.font('bold').fontSize(12).text('Summary', 48);
    row(doc, 'Total income', naira(f.grossKobo));
    row(doc, 'Total expenses', `−${naira(f.expensesKobo)}`);
    row(doc, 'Management fees', `−${naira(f.feeKobo + f.fixedFeeKobo)}`);
    if (f.openingBalanceKobo) row(doc, 'Brought forward', naira(f.openingBalanceKobo));
    row(doc, f.netPayoutKobo < 0 ? 'Owner owes' : 'Payable to owner', naira(Math.abs(f.netPayoutKobo)), { bold: true });
    if (f.outstanding.length) {
      doc.moveDown(0.6).font('body').fontSize(9).fillColor('#5b6d72').text(`Not yet paid by guests (not deducted): ${f.outstanding.map((o) => `${o.ref} ${naira(o.balanceKobo)}`).join(', ')}`, 48).fillColor('#182d32');
    }
    if (s.owner.accountNumber) doc.moveDown(0.6).font('body').fontSize(9).text(`Pay to: ${s.owner.accountName ?? s.owner.name}, ${s.owner.bankName ?? ''} ${s.owner.accountNumber}`, 48);
    footer(doc, `${s.org.name} · Generated by Boogbe`);
  }, { ...opts, subject: [s.number, s.owner.name, s.org.name].join(' · ') });
}
```
`StatementsService` additions:
```ts
  finalise(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const s = await tx.statement.findFirst({ where: { id } });
      if (!s) throw notFound('Statement');
      if (s.status !== 'draft') throw new AppError('INVALID_TRANSITION', 422, 'Already finalised');
      await this.generateIn(tx, ctx.orgId, iso(s.period), s.ownerId);
      const fresh = (await tx.statement.findFirst({ where: { id } }))!;
      const settings = await tx.orgSettings.findFirstOrThrow();
      const seq = await this.orgDb.nextNumber(tx, 'statement');
      const number = `${settings.statementPrefix}-S-${iso(s.period).slice(0, 7)}-${String(seq).padStart(3, '0')}`;
      const owner = await tx.owner.findFirstOrThrow({ where: { id: s.ownerId } });
      const org = await this.orgInfo.get(ctx.orgId);
      const logo = settings.logoKey ? await this.storage.get(settings.logoKey) : null;
      const pdf = await renderStatement({ org: { ...org, logo }, number, owner, figures: fresh.figures as never });
      const { key } = await this.files.storeGenerated(ctx.orgId, 'statement_pdf', pdf, ctx.memberId);
      await tx.statement.updateMany({ where: { id, status: 'draft' }, data: { status: 'finalised', number, pdfFileKey: key, finalisedAt: new Date(), finalisedByMemberId: ctx.memberId } });
      await this.audit.record(tx, { actor: ctx, action: 'statement.finalise', entity: 'statement', entityId: id, after: { number, netPayoutKobo: Number(fresh.netPayoutKobo) } });
      return this.toSummary(tx, (await tx.statement.findFirst({ where: { id } }))!);
    }, { timeoutMs: 60_000 });
  }

  markPaid(ctx: OrgCtx, id: string, input: { paidOn: IsoDate; payoutReference: string }) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await tx.statement.updateMany({ where: { id, status: 'finalised' }, data: { status: 'paid', paidOn: day(input.paidOn), payoutReference: input.payoutReference } });
      if (!r.count) throw new AppError('INVALID_TRANSITION', 422, 'Only finalised statements can be marked paid');
      await this.audit.record(tx, { actor: ctx, action: 'statement.paid', entity: 'statement', entityId: id, after: input });
      return this.toSummary(tx, (await tx.statement.findFirst({ where: { id } }))!);
    });
  }

  async pdfUrl(ctx: OrgCtx, id: string, where: Prisma.StatementWhereInput = {}) {
    const s = await this.orgDb.run(ctx.orgId, (tx) => tx.statement.findFirst({ where: { id, ...where } }));
    if (!s || !s.pdfFileKey) throw notFound('Statement PDF');
    return this.files.signedUrlForKey(s.pdfFileKey, `${s.number}.pdf`);
  }
```
(Inject `OrgInfo`, `FilesService`, `@Inject(STORAGE) storage: Storage`.) **Note:** `storeGenerated` opens its own `OrgDb.run`; calling it inside an outer `run` would use a second connection — acceptable because the `file` row is independent; if the outer transaction rolls back, an orphan file row remains (harmless). Document that in a code comment.

Controller additions: `POST :id/finalise` (200), `POST :id/paid` (`MarkPaidInput`, 200), `GET :id/pdf` (`@Res()` → `res.redirect(302, url)`).

`statements-monthly.job.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { todayIn } from '@boogbe/shared';
import { OrgDb } from '../../common/db/org-db.service';
import { JobRunner } from '../../common/jobs/job-runner';
import { NotificationsService } from '../notifications/notifications.service';
import { StatementsService } from './statements.service';

const hourIn = (tz: string, now: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
const prevMonth = (today: string) => { const [y, m] = today.split('-').map(Number); return m === 1 ? `${y! - 1}-12-01` : `${y}-${String(m! - 1).padStart(2, '0')}-01`; };

@Injectable()
export class StatementsMonthlyJob {
  constructor(private readonly runner: JobRunner, private readonly orgDb: OrgDb, private readonly statements: StatementsService, private readonly notifications: NotificationsService) {}
  async run(now = new Date()) {
    return this.runner.forEachActiveOrg('statements.monthly', async (org) => {
      const today = todayIn(org.timezone, now);
      if (!today.endsWith('-01') || hourIn(org.timezone, now) < 6) return;
      const period = prevMonth(today);
      await this.orgDb.run(org.id, async (tx) => {
        const items = await this.statements.generateIn(tx, org.id, period);
        if (items.length) await this.notifications.notifyRoles(tx, org.id, ['admin'], { kind: 'statements_ready', title: `Owner statements ready for review (${items.length})`, body: 'Check the drafts, then finalise and send them.', link: `/statements?period=${period}`, dedupeKey: `statements-${period}` }, { email: true });
      }, { timeoutMs: 120_000 });
    });
  }
}
```
(Runs every hour on the 1st from 06:00; `generateIn` only refreshes drafts, and the notification is deduped — harmless repeats.) `OwnersCrons` in the worker: `@Cron('0 * * * *') monthly() { return this.job.run(); }`.

- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -m "feat(statements): finalise with numbered PDF, mark paid, monthly drafts and month locks [OWN-05 OWN-06]"`

---

### Task 7 (T-M7-07) [api]: Owner portal API

**Files:** Create `apps/api/src/modules/owners/{portal.controller.ts,portal.service.ts}`; Test `apps/api/test/portal.int.ts`.

**Interfaces:**
- All `portal.read`. Resolve owner: `owner WHERE user_id = ctx.userId AND active` → 404 `NOT_FOUND` "Your owner profile is not linked yet" if none.
- `GET /v1/portal/summary?month=YYYY-MM-01` → `PortalSummary`: units the owner owns **today** (or owned in the month); occupancy % = booked nights in month (to date for the current month) / (days elapsed × units) × 100, 1 decimal; revenue MTD = Σ recognised revenue for owned nights in month; upcoming = next 10 stays on their units (`guestName` only when `org_settings.owner_sees_guest_names`); statements = finalised/paid only.
- `GET /v1/portal/statements/:id` → `StatementDetail` (finalised/paid, own only); `GET /v1/portal/statements/:id/pdf` → 302.
- Never returns guest phone/email, check-in instructions, other owners' units or expenses detail of other owners.

- [ ] **Step 1: Failing test** `apps/api/test/portal.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedBooking, seedGuest, seedOwner, seedProperty, seedUnit } from './helpers/inventory';

describe('owner portal [OWN-08 ORG-04]', () => {
  let t: TestApp; let admin: Agent; let orgId: string; let mine: string; let theirs: string; let ownerAgent: Agent;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg()).id;
    const m = await migratorClient();
    await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'T','T','T',now())`, [orgId]);
    const landlord = await signInAs(t, 'landlord', orgId);
    const me = await seedOwner(orgId, { name: 'Me' }); const other = await seedOwner(orgId, { name: 'Other' });
    await m.query(`update owner set user_id = $1 where id = $2`, [landlord.userId, me]);
    await m.end();
    const p = await seedProperty(orgId);
    mine = await seedUnit(orgId, p, { name: 'Mine', ownerId: me }); theirs = await seedUnit(orgId, p, { name: 'Theirs', ownerId: other });
    const soon = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    await seedBooking(orgId, mine, await seedGuest(orgId, { fullName: 'Secret Guest' }), { checkIn: soon(3), checkOut: soon(5) });
    await seedBooking(orgId, theirs, await seedGuest(orgId), { checkIn: soon(3), checkOut: soon(5) });
    admin = (await signInAs(t, 'admin', orgId)).agent; ownerAgent = landlord.agent;
  });

  it('shows only own units; hides guest names by default', async () => {
    const s = (await ownerAgent.get('/v1/portal/summary').expect(200)).body;
    expect(s.units.map((u: { name: string }) => u.name)).toEqual(['Mine']);
    expect(s.upcoming).toEqual([expect.objectContaining({ unitName: 'Mine', guestName: null })]);
    expect(JSON.stringify(s)).not.toContain('Secret Guest');
  });

  it('shows guest names when the operator allows it', async () => {
    await admin.patch('/v1/org/settings').send({ ownerSeesGuestNames: true }).expect(200);
    expect((await ownerAgent.get('/v1/portal/summary').expect(200)).body.upcoming[0].guestName).toBe('Secret Guest');
  });

  it("cannot read another owner's statement or any draft; cannot use staff routes", async () => {
    const items = (await admin.post('/v1/statements/generate').send({ period: new Date().toISOString().slice(0, 7) + '-01' }).expect(200)).body.items as { id: string; owner: { name: string } }[];
    const mineS = items.find((s) => s.owner.name === 'Me')!; const otherS = items.find((s) => s.owner.name === 'Other')!;
    await ownerAgent.get(`/v1/portal/statements/${mineS.id}`).expect(404); // still draft
    await admin.post(`/v1/statements/${mineS.id}/finalise`).expect(200);
    await admin.post(`/v1/statements/${otherS.id}/finalise`).expect(200);
    await ownerAgent.get(`/v1/portal/statements/${mineS.id}`).expect(200);
    await ownerAgent.get(`/v1/portal/statements/${otherS.id}`).expect(404);
    await ownerAgent.get('/v1/bookings').expect(403);
    await ownerAgent.get('/v1/calendar?from=2026-11-01&to=2026-11-10').expect(403);
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `portal.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { ACTIVE_STATUSES, addDays, eachNight, inMonth, monthOf, nightsBetween, ownerOn, sumKobo, todayIn, type IsoDate, type PortalSummary } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { StatementInputsLoader, nextMonth } from './statement-inputs';
import { StatementsService } from './statements.service';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: IsoDate) => new Date(`${s}T00:00:00Z`);

@Injectable()
export class PortalService {
  constructor(private readonly orgDb: OrgDb, private readonly loader: StatementInputsLoader, private readonly statements: StatementsService) {}

  private async me(tx: OrgTx, ctx: OrgCtx) {
    const o = await tx.owner.findFirst({ where: { userId: ctx.userId, active: true } });
    if (!o) throw notFound('Your owner profile is not linked yet — ask your manager');
    return o;
  }

  summary(ctx: OrgCtx, monthParam?: IsoDate): Promise<PortalSummary> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const owner = await this.me(tx, ctx);
      const today = todayIn(ctx.timezone); const month = monthParam ?? monthOf(today);
      const data = await this.loader.load(tx, ctx.orgId, month);
      const myUnitIds = data.units.filter((u) => (data.ownership[u.unitId] ?? []).some((p) => p.ownerId === owner.id && p.from < nextMonth(month) && (p.to === null || p.to > month))).map((u) => u.unitId);
      const lastDay = month === monthOf(today) ? addDays(today, 1) : nextMonth(month);
      const days = eachNight(month, lastDay).length || 1;
      const settings = await tx.orgSettings.findFirstOrThrow();
      const bookings = await tx.booking.findMany({ where: { unitId: { in: myUnitIds }, status: { in: [...ACTIVE_STATUSES, 'checked_out'] }, checkIn: { lt: day(lastDay) }, checkOut: { gt: day(month) } } });
      const units = data.units.filter((u) => myUnitIds.includes(u.unitId)).map((u) => {
        const booked = bookings.filter((b) => b.unitId === u.unitId).flatMap((b) => eachNight(iso(b.checkIn), iso(b.checkOut))).filter((n) => n >= month && n < lastDay && ownerOn(data.ownership[u.unitId] ?? [], n).ownerId === owner.id).length;
        const revenue = sumKobo(data.revenue.filter((r) => r.unitId === u.unitId && inMonth(r.date, month) && r.date < lastDay && ownerOn(data.ownership[u.unitId] ?? [], r.date).ownerId === owner.id).map((r) => r.amountKobo));
        return { id: u.unitId, name: u.unitName, propertyName: u.propertyName, occupancyPct: Math.round((booked / days) * 1000) / 10, revenueMtdKobo: revenue };
      });
      const upcomingRows = await tx.booking.findMany({ where: { unitId: { in: myUnitIds }, status: { in: [...ACTIVE_STATUSES] }, checkOut: { gt: day(today) } }, include: { guest: true, unit: true }, orderBy: { checkIn: 'asc' }, take: 10 });
      const statements = (await tx.statement.findMany({ where: { ownerId: owner.id, status: { in: ['finalised', 'paid'] } }, orderBy: { period: 'desc' } }));
      const summaries = []; for (const s of statements) summaries.push(await this.statements.toSummary(tx, s));
      return {
        owner: { id: owner.id, name: owner.name }, month, units,
        upcoming: upcomingRows.map((b) => ({ unitName: b.unit.name, checkIn: iso(b.checkIn), checkOut: iso(b.checkOut), nights: nightsBetween(iso(b.checkIn), iso(b.checkOut)), guestName: settings.ownerSeesGuestNames ? b.guest.fullName : null })),
        statements: summaries,
      };
    });
  }

  statement(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => { const o = await this.me(tx, ctx); return this.statements.detailIn(tx, id, { ownerId: o.id, status: { in: ['finalised', 'paid'] } }); });
  }

  async pdf(ctx: OrgCtx, id: string) {
    const o = await this.orgDb.run(ctx.orgId, (tx) => this.me(tx, ctx));
    return this.statements.pdfUrl(ctx, id, { ownerId: o.id, status: { in: ['finalised', 'paid'] } });
  }
}
```
Controller `@Controller('portal')`: `GET summary` (`portal.read`, optional `month` validated as first-of-month), `GET statements/:id`, `GET statements/:id/pdf` (302). Isolation: route `/^\/v1\/portal\/statements\//` → `statement` fixture (an admin of org A calling it gets 403 — permission, which the harness accepts only as 404/400; therefore run the portal routes in the isolation sweep with a **landlord** of org A: extend the harness to pick the agent by `access.permission === 'portal.read'` → landlord agent).

- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -m "feat(portal): owner portal summary, occupancy, statements with guest-name privacy [OWN-08 ORG-04]"`

---

### Task 8 (T-M7-08) [ui]: Expenses and statements

**Files:** Create `apps/app/src/features/owners-money/{ExpensesPage.tsx,ExpenseForm.tsx,StatementsPage.tsx,StatementDetail.tsx,FiguresView.tsx,hooks.ts}`; router `/expenses` (nav "Expenses" `expenses.read`, icon `Receipt`), `/statements`, `/statements/:id` (nav "Statements" `statements.read`, icon `FileText`); Test `apps/app/src/features/owners-money/ExpenseForm.test.tsx`, `FiguresView.test.tsx`.

**Interfaces:**
- `ExpenseForm({ initial?, onSaved })`: date, property, "Whole property" toggle → unit checklist with Equal / Custom % split (custom inputs must total 100 %, live remainder shown), category, amount (`MoneyInput`), description, "Charge to owner" (default on), receipt photo (`uploadFile('receipt_image', compressImage(file))` for images; PDFs uploaded as-is). Shows the server's 422 month-lock message.
- `ExpensesPage`: month picker, property/category filters, list with locked badge, total.
- `StatementsPage`: month picker (default previous month), "Generate drafts" button, table (owner, gross, expenses, fees, payout / owes, status badge, number); row → detail.
- `StatementDetail`: `FiguresView` + actions: Recalculate (draft), Finalise (confirm: "This locks the figures and the month's expenses for this owner"), Download PDF (finalised/paid), Mark paid (date + reference), "Send to owner" → opens `mailto:` with the PDF link? — **no**: v1 shows a WhatsApp button that opens `wa.me/<owner phone>` with text "Your <month> statement from <operator> is ready in the owner portal: <APP_ORIGIN>/owner" (portal link, not the PDF URL, which expires).
- `FiguresView({ figures })`: per-unit cards with lines and totals, expenses table, summary with "Payable to owner" / "Owner owes", outstanding note.

- [ ] **Step 1: Failing tests**

`ExpenseForm.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { ExpenseForm } from './ExpenseForm';

vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: vi.fn(async (p: string, init?: { method?: string }) => {
  if (p.startsWith('/v1/properties')) return { items: [{ id: 'p1', name: 'Rock', address: 'x', area: null, notes: null, sortOrder: 0, active: true, unitCount: 2, feeType: 'none', feeBps: 0, feeFixedMonthlyKobo: 0, defaultOwnerId: null, defaultOwnerName: null }] };
  if (p.startsWith('/v1/units')) return { items: [{ id: 'a', name: 'A', propertyId: 'p1' }, { id: 'b', name: 'B', propertyId: 'p1' }] };
  if (init?.method === 'POST') return { id: 'e1' };
  return {};
}) }));
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { role: 'admin', timezone: 'Africa/Lagos' } } }) }));

describe('ExpenseForm', () => {
  it('requires custom shares to total 100% before saving a property-wide expense', async () => {
    const onSaved = vi.fn();
    render(<SWRConfig value={{ provider: () => new Map() }}><ExpenseForm onSaved={onSaved} /></SWRConfig>);
    await userEvent.selectOptions(await screen.findByLabelText('Property'), 'p1');
    await userEvent.click(screen.getByLabelText('Whole property (shared cost)'));
    await userEvent.click(screen.getByLabelText('Custom split'));
    await userEvent.type(screen.getByLabelText('Share for A'), '60');
    await userEvent.type(screen.getByLabelText('Share for B'), '30');
    expect(screen.getByText('10% left to assign')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Amount'), '50000');
    await userEvent.type(screen.getByLabelText('Description'), 'Diesel');
    await userEvent.click(screen.getByRole('button', { name: 'Save expense' }));
    expect(onSaved).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('Share for B')); await userEvent.type(screen.getByLabelText('Share for B'), '40');
    await userEvent.click(screen.getByRole('button', { name: 'Save expense' }));
    expect(api).toHaveBeenCalledWith('/v1/expenses', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ unitId: null, allocation: { method: 'custom', unitIds: ['a', 'b'], customBps: { a: 6000, b: 4000 } } }) }));
  });
});
```
`FiguresView.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FiguresView } from './FiguresView';

describe('FiguresView', () => {
  it('labels a negative payout as owed by the owner', () => {
    render(<FiguresView figures={{ period: '2026-10-01', units: [], expenses: [], openingBalanceKobo: -3_000_000, grossKobo: 0, expensesKobo: 10_000_000, feeKobo: 0, fixedFeeKobo: 0, netPayoutKobo: -13_000_000, outstanding: [] }} />);
    expect(screen.getByText('Owner owes')).toBeInTheDocument();
    expect(screen.getByText('₦130,000')).toBeInTheDocument();
    expect(screen.getByText('Brought forward')).toBeInTheDocument();
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement**

`FiguresView.tsx`:
```tsx
import { formatNaira, type StatementDetail } from '@boogbe/shared';
import { Card } from '@boogbe/ui';
import { formatDate } from '../../lib/format';

const SOURCE = { stay: 'Stay', cancellation: 'Cancellation kept', damage: 'Damage from deposit' } as const;
const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => <div className={`flex justify-between ${strong ? 'font-semibold' : ''}`}><span>{label}</span><span>{value}</span></div>;

export function FiguresView({ figures: f }: { figures: StatementDetail['figures'] }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      {f.units.map((u) => (
        <Card key={u.unitId} className="flex flex-col gap-1">
          <p className="font-semibold">{u.unitName} <span className="font-normal text-ink-muted">· {u.propertyName} · {u.feeLabel}</span></p>
          {u.lines.map((l, i) => <Row key={i} label={`${formatDate(l.date)} · ${l.ref} · ${SOURCE[l.source]}`} value={formatNaira(l.amountKobo)} />)}
          <Row label="Income" value={formatNaira(u.grossKobo)} strong />
          {u.expensesKobo > 0 && <Row label="Expenses" value={`−${formatNaira(u.expensesKobo)}`} />}
          {u.feeKobo > 0 && <Row label="Management fee" value={`−${formatNaira(u.feeKobo)}`} />}
          {u.fixedFeeKobo > 0 && <Row label="Fixed monthly fee" value={`−${formatNaira(u.fixedFeeKobo)}`} />}
        </Card>
      ))}
      {f.expenses.length > 0 && <Card><p className="mb-1 font-semibold">Expenses</p>{f.expenses.map((e, i) => <Row key={i} label={`${formatDate(e.date)} · ${e.unitName} · ${e.description}`} value={formatNaira(e.amountKobo)} />)}</Card>}
      <Card className="flex flex-col gap-1">
        <Row label="Total income" value={formatNaira(f.grossKobo)} />
        <Row label="Total expenses" value={`−${formatNaira(f.expensesKobo)}`} />
        <Row label="Management fees" value={`−${formatNaira(f.feeKobo + f.fixedFeeKobo)}`} />
        {f.openingBalanceKobo !== 0 && <Row label="Brought forward" value={formatNaira(f.openingBalanceKobo)} />}
        <Row label={f.netPayoutKobo < 0 ? 'Owner owes' : 'Payable to owner'} value={formatNaira(Math.abs(f.netPayoutKobo))} strong />
        {f.outstanding.length > 0 && <p className="text-xs text-ink-muted">Not yet paid by guests (not deducted): {f.outstanding.map((o) => `${o.ref} ${formatNaira(o.balanceKobo)}`).join(', ')}</p>}
      </Card>
    </div>
  );
}
```
`ExpenseForm.tsx`:
```tsx
import { useState } from 'react';
import { z } from 'zod';
import { EXPENSE_CATEGORY_LABELS, ExpenseCategory, Property, todayIn, type Expense } from '@boogbe/shared';
import { Button, Field, Input, Select } from '@boogbe/ui';
import { api, ApiError, useApi } from '../../lib/api';
import { compressImage } from '../../lib/compress-image';
import { uploadFile } from '../../lib/upload';
import { useMe } from '../../lib/use-me';
import { MoneyInput } from '../inventory/money-input';

export function ExpenseForm({ initial, onSaved }: { initial?: Expense; onSaved: () => void }) {
  const { me } = useMe();
  const { data: props } = useApi('/v1/properties', z.object({ items: z.array(Property) }));
  const [v, setV] = useState({
    incurredOn: initial?.incurredOn ?? todayIn(me?.activeOrg?.timezone ?? 'Africa/Lagos'), propertyId: initial?.property.id ?? '',
    whole: initial ? initial.unit === null : false, unitId: initial?.unit?.id ?? '', category: (initial?.category ?? 'repairs') as z.infer<typeof ExpenseCategory>,
    amountKobo: initial?.amountKobo ?? 0, description: initial?.description ?? '', chargeToOwner: initial?.chargeToOwner ?? true, receiptFileId: initial?.receiptFileId ?? null as string | null,
    custom: false, selected: initial?.allocations.map((a) => a.unitId) ?? [] as string[], pct: Object.fromEntries(initial?.allocations.map((a) => [a.unitId, String(a.shareBps / 100)]) ?? []) as Record<string, string>,
  });
  const { data: units } = useApi(v.propertyId ? `/v1/units?propertyId=${v.propertyId}` : null, z.object({ items: z.array(z.object({ id: z.string(), name: z.string() })) }));
  const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  const totalPct = v.selected.reduce((s, id) => s + Number(v.pct[id] || 0), 0);
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault(); setErr(undefined);
      if (v.whole && v.custom && Math.round(totalPct * 100) !== 10_000) return setErr('Shares must add up to 100%');
      if (v.whole && !v.selected.length) return setErr('Choose the units that share this cost');
      setBusy(true);
      const body = {
        incurredOn: v.incurredOn, propertyId: v.propertyId, unitId: v.whole ? null : v.unitId, category: v.category, amountKobo: v.amountKobo,
        description: v.description, chargeToOwner: v.chargeToOwner, receiptFileId: v.receiptFileId,
        ...(v.whole && { allocation: v.custom ? { method: 'custom', unitIds: v.selected, customBps: Object.fromEntries(v.selected.map((id) => [id, Math.round(Number(v.pct[id] || 0) * 100)])) } : { method: 'equal', unitIds: v.selected } }),
      };
      try { await api(initial ? `/v1/expenses/${initial.id}` : '/v1/expenses', { method: initial ? 'PATCH' : 'POST', body }); onSaved(); }
      catch (x) { setErr(x instanceof ApiError ? x.message : String(x)); } finally { setBusy(false); }
    }}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date"><Input type="date" value={v.incurredOn} onChange={(e) => setV({ ...v, incurredOn: e.target.value })} /></Field>
        <Field label="Category"><Select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as typeof v.category })}>{ExpenseCategory.options.map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>)}</Select></Field>
      </div>
      <Field label="Property"><Select value={v.propertyId} onChange={(e) => setV({ ...v, propertyId: e.target.value, unitId: '', selected: [] })}><option value="">Choose…</option>{props?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.whole} onChange={(e) => setV({ ...v, whole: e.target.checked })} />Whole property (shared cost)</label>
      {!v.whole && <Field label="Unit"><Select value={v.unitId} onChange={(e) => setV({ ...v, unitId: e.target.value })}><option value="">Choose…</option>{units?.items.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>}
      {v.whole && (
        <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <legend className="text-sm font-medium">Shared by</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.custom} onChange={(e) => setV({ ...v, custom: e.target.checked })} />Custom split</label>
          {units?.items.map((u) => (
            <div key={u.id} className="flex items-center gap-2">
              <label className="flex flex-1 items-center gap-2 text-sm"><input type="checkbox" checked={v.selected.includes(u.id)} onChange={(e) => setV({ ...v, selected: e.target.checked ? [...v.selected, u.id] : v.selected.filter((x) => x !== u.id) })} />{u.name}</label>
              {v.custom && v.selected.includes(u.id) && <Input aria-label={`Share for ${u.name}`} inputMode="decimal" className="w-24" value={v.pct[u.id] ?? ''} onChange={(e) => setV({ ...v, pct: { ...v.pct, [u.id]: e.target.value.replace(/[^\d.]/g, '') } })} />}
            </div>
          ))}
          {v.custom && <p className="text-xs text-ink-muted">{Math.round((100 - totalPct) * 100) / 100}% left to assign</p>}
        </fieldset>
      )}
      <Field label="Amount"><MoneyInput value={v.amountKobo} onChange={(k) => setV({ ...v, amountKobo: k })} /></Field>
      <Field label="Description"><Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.chargeToOwner} onChange={(e) => setV({ ...v, chargeToOwner: e.target.checked })} />Charge to the owner's statement</label>
      <Field label="Receipt (photo or PDF)"><input type="file" accept="image/*,application/pdf" onChange={async (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        try { setV({ ...v, receiptFileId: await uploadFile('receipt_image', f.type === 'application/pdf' ? f : await compressImage(f, { maxBytes: 1_500_000 })) }); } catch (x) { setErr((x as Error).message); }
      }} /></Field>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <Button type="submit" loading={busy}>Save expense</Button>
    </form>
  );
}
```
(The test expects "10% left to assign": `100 − 90 = 10` renders as `10% left to assign`.)

`ExpensesPage.tsx`, `StatementsPage.tsx`, `StatementDetail.tsx` follow the M3 `MoneyPage` / M2 `BookingsPage` patterns:
```tsx
// StatementsPage.tsx
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { formatNaira, monthOf, StatementSummary, todayIn } from '@boogbe/shared';
import { Badge, Button, EmptyState, Input, Spinner, Table } from '@boogbe/ui';
import { api, useApi } from '../../lib/api';
import { useMe } from '../../lib/use-me';

const prev = (m: string) => { const [y, mm] = m.split('-').map(Number); return mm === 1 ? `${y! - 1}-12-01` : `${y}-${String(mm! - 1).padStart(2, '0')}-01`; };
const TONE = { draft: 'warning', finalised: 'info', paid: 'success' } as const;

export function StatementsPage() {
  const { me } = useMe(); const nav = useNavigate(); const [params] = useSearchParams();
  const [period, setPeriod] = useState(params.get('period') ?? prev(monthOf(todayIn(me?.activeOrg?.timezone ?? 'Africa/Lagos'))));
  const { data, mutate } = useApi(`/v1/statements?period=${period}`, z.object({ items: z.array(StatementSummary) }));
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="mr-auto text-xl font-semibold">Owner statements</h1>
        <Input aria-label="Month" type="month" value={period.slice(0, 7)} onChange={(e) => setPeriod(`${e.target.value}-01`)} className="w-44" />
        <Button loading={busy} onClick={async () => { setBusy(true); await api('/v1/statements/generate', { method: 'POST', body: { period } }); setBusy(false); await mutate(); }}>Generate drafts</Button></div>
      {!data ? <Spinner /> : data.items.length === 0 ? <EmptyState title="No statements for this month" body="Generate drafts to calculate each owner's figures." /> : (
        <Table rows={data.items} onRowClick={(s) => nav(`/statements/${s.id}`)} columns={[
          { key: 'o', header: 'Owner', cell: (s) => s.owner.name },
          { key: 'g', header: 'Income', cell: (s) => formatNaira(s.grossKobo), className: 'text-right' },
          { key: 'e', header: 'Expenses', cell: (s) => formatNaira(s.expensesKobo), className: 'text-right' },
          { key: 'f', header: 'Fees', cell: (s) => formatNaira(s.feeKobo + s.fixedFeeKobo), className: 'text-right' },
          { key: 'n', header: 'Payout', cell: (s) => (s.netPayoutKobo < 0 ? `Owes ${formatNaira(-s.netPayoutKobo)}` : formatNaira(s.netPayoutKobo)), className: 'text-right' },
          { key: 's', header: 'Status', cell: (s) => <Badge tone={TONE[s.status]}>{s.status}</Badge> },
          { key: 'no', header: 'Number', cell: (s) => s.number ?? '—' },
        ]} />
      )}
    </div>
  );
}
```
```tsx
// StatementDetail.tsx
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Owner, StatementDetail as Detail, waLink } from '@boogbe/shared';
import { Badge, Button, Card, Dialog, Field, Input, Spinner } from '@boogbe/ui';
import { z } from 'zod';
import { api, ApiError, useApi } from '../../lib/api';
import { FiguresView } from './FiguresView';

export function StatementDetail() {
  const { id = '' } = useParams();
  const { data: s, mutate } = useApi(`/v1/statements/${id}`, Detail);
  const { data: owners } = useApi('/v1/owners', z.object({ items: z.array(Owner) }));
  const [paid, setPaid] = useState(false); const [p, setP] = useState({ paidOn: new Date().toISOString().slice(0, 10), payoutReference: '' }); const [err, setErr] = useState<string>();
  if (!s) return <Spinner />;
  const owner = owners?.items.find((o) => o.id === s.owner.id);
  const act = async (path: string, body?: unknown) => { setErr(undefined); try { await api(path, { method: 'POST', body }); await mutate(); } catch (x) { setErr(x instanceof ApiError ? x.message : String(x)); } };
  const month = new Date(`${s.period}T00:00:00Z`).toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">{s.owner.name} — {month}</h1><Badge>{s.status}</Badge>{s.number && <span className="text-sm text-ink-muted">{s.number}</span>}
        <div className="flex w-full flex-wrap gap-2">
          {s.status === 'draft' && <><Button variant="secondary" onClick={() => act(`/v1/statements/${id}/regenerate`)}>Recalculate</Button>
            <Button onClick={() => confirm("Finalise? The figures and this month's expenses for this owner will be locked.") && act(`/v1/statements/${id}/finalise`)}>Finalise</Button></>}
          {s.status !== 'draft' && <a href={`${import.meta.env.VITE_API_ORIGIN ?? ''}/v1/statements/${id}/pdf`}><Button variant="secondary">Download PDF</Button></a>}
          {s.status === 'finalised' && <Button onClick={() => setPaid(true)}>Mark paid</Button>}
          {s.status !== 'draft' && owner?.phone && <a href={waLink(owner.phone, `Hello ${owner.name}, your ${month} statement is ready in the owner portal: ${window.location.origin}/owner`)} target="_blank" rel="noreferrer"><Button variant="secondary">Tell owner on WhatsApp</Button></a>}
        </div>
        {s.paidOn && <p className="w-full text-sm">Paid {s.paidOn} · {s.payoutReference}</p>}
        {err && <p role="alert" className="w-full text-sm text-danger">{err}</p>}
      </Card>
      <FiguresView figures={s.figures} />
      <Dialog open={paid} onClose={() => setPaid(false)} title="Mark as paid">
        <form className="flex flex-col gap-3" onSubmit={async (e) => { e.preventDefault(); await act(`/v1/statements/${id}/paid`, p); setPaid(false); }}>
          <Field label="Paid on"><Input type="date" value={p.paidOn} onChange={(e) => setP({ ...p, paidOn: e.target.value })} /></Field>
          <Field label="Transfer reference"><Input required value={p.payoutReference} onChange={(e) => setP({ ...p, payoutReference: e.target.value })} /></Field>
          <Button type="submit">Save</Button>
        </form>
      </Dialog>
    </div>
  );
}
```
`ExpensesPage.tsx`: month input (`from` = first of month, `to` = next month), property + category selects, `Table` (date, property/unit or "Shared: A, B", category label, description, amount, "Locked" badge, receipt link via `/v1/files/:id/url`), total row, "Add expense" dialog with `ExpenseForm`; clicking an unlocked row opens it for editing; a Delete button in the edit dialog.

- [ ] **Step 4:** PASS + build. **Step 5: Commit** `git commit -m "feat(app): expenses with shared-cost split and receipts; owner statements review, finalise and payout [OWN-01 OWN-02 OWN-04 OWN-05]"`

---

### Task 9 (T-M7-09) [ui][e2e]: Owner portal and E2E-06

**Files:** Create `apps/app/src/features/portal/{OwnerPortal.tsx,PortalStatement.tsx}`; router replaces `/owner` placeholder with lazy `OwnerPortal` (`/owner`, `/owner/statements/:id`); Create `e2e/e06-owner-statement.spec.ts`; Test `apps/app/src/features/portal/OwnerPortal.test.tsx`.

**Interfaces:** `OwnerPortal`: own minimal shell (operator logo/name, owner name, bell); month switcher; unit cards (occupancy % as a bar with text label, revenue MTD); "Coming up" list (unit, dates, nights, guest name or "Guest"); statements list (month, payout/owes, status, Download PDF via `/v1/portal/statements/:id/pdf`); `PortalStatement` renders `FiguresView` read-only.

- [ ] **Step 1: Failing test**
```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import OwnerPortal from './OwnerPortal';

vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: vi.fn(async () => ({
  owner: { id: 'o', name: 'Mrs Adebayo' }, month: '2026-10-01',
  units: [{ id: 'u', name: 'Kairo', propertyName: 'Rock', occupancyPct: 64.5, revenueMtdKobo: 120_000_000 }],
  upcoming: [{ unitName: 'Kairo', checkIn: '2026-10-20', checkOut: '2026-10-23', nights: 3, guestName: null }],
  statements: [{ id: 's1', number: 'TAN-S-2026-09-001', owner: { id: 'o', name: 'Mrs Adebayo' }, period: '2026-09-01', status: 'paid', grossKobo: 1, expensesKobo: 0, feeKobo: 0, fixedFeeKobo: 0, openingBalanceKobo: 0, netPayoutKobo: 90_000_000, finalisedAt: '', paidOn: '2026-10-03', payoutReference: 'x' }],
})) }));
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { name: 'Tanuhomes', role: 'landlord', timezone: 'Africa/Lagos' } } }) }));

describe('OwnerPortal', () => {
  it('shows occupancy, revenue, upcoming stays without guest names, and statements', async () => {
    render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter><OwnerPortal /></MemoryRouter></SWRConfig>);
    expect(await screen.findByText('Mrs Adebayo')).toBeInTheDocument();
    expect(screen.getByText('64.5% booked')).toBeInTheDocument();
    expect(screen.getByText('₦1,200,000')).toBeInTheDocument();
    expect(screen.getByText(/Guest · 3 nights/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Download September 2026/ })).toHaveAttribute('href', '/v1/portal/statements/s1/pdf');
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `OwnerPortal.tsx`:
```tsx
import { useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { formatNaira, monthOf, PortalSummary, todayIn } from '@boogbe/shared';
import { Badge, Card, EmptyState, Input, Spinner } from '@boogbe/ui';
import { NotificationBell } from '../../components/shell/NotificationBell';
import { useApi } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useMe } from '../../lib/use-me';
import { PortalStatement } from './PortalStatement';

const monthName = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function Summary() {
  const { me } = useMe(); const [month, setMonth] = useState(monthOf(todayIn(me?.activeOrg?.timezone ?? 'Africa/Lagos')));
  const { data } = useApi(`/v1/portal/summary?month=${month}`, PortalSummary);
  if (!data) return <Spinner />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2"><h1 className="mr-auto text-xl font-semibold">{data.owner.name}</h1><Input aria-label="Month" type="month" value={month.slice(0, 7)} onChange={(e) => setMonth(`${e.target.value}-01`)} className="w-44" /></div>
      <div className="grid gap-3 md:grid-cols-2">
        {data.units.map((u) => (
          <Card key={u.id} className="flex flex-col gap-2">
            <p className="font-semibold">{u.name} <span className="font-normal text-ink-muted">{u.propertyName}</span></p>
            <div className="h-2 rounded-full bg-surface-2" aria-hidden><div className="h-2 rounded-full bg-brand" style={{ width: `${Math.min(100, u.occupancyPct)}%` }} /></div>
            <p className="text-sm">{u.occupancyPct}% booked</p>
            <p className="text-sm text-ink-muted">Income this month</p><p className="text-lg font-semibold">{formatNaira(u.revenueMtdKobo)}</p>
          </Card>
        ))}
      </div>
      <Card><h2 className="mb-2 font-semibold">Coming up</h2>
        {data.upcoming.length === 0 ? <EmptyState title="No upcoming stays" /> : data.upcoming.map((b, i) => <p key={i} className="border-t border-line py-2 text-sm">{b.unitName} · {formatDate(b.checkIn)} – {formatDate(b.checkOut)} · {b.guestName ?? 'Guest'} · {b.nights} nights</p>)}
      </Card>
      <Card><h2 className="mb-2 font-semibold">Statements</h2>
        {data.statements.length === 0 ? <EmptyState title="No statements yet" /> : data.statements.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 text-sm">
            <Link to={`/owner/statements/${s.id}`} className="text-brand">{monthName(s.period)}</Link>
            <span>{s.netPayoutKobo < 0 ? `You owe ${formatNaira(-s.netPayoutKobo)}` : formatNaira(s.netPayoutKobo)}</span>
            <Badge tone={s.status === 'paid' ? 'success' : 'info'}>{s.status === 'paid' ? `Paid ${s.paidOn}` : 'Awaiting payment'}</Badge>
            <a href={`${import.meta.env.VITE_API_ORIGIN ?? ''}/v1/portal/statements/${s.id}/pdf`} aria-label={`Download ${monthName(s.period)}`} className="text-brand">PDF</a>
          </div>
        ))}
      </Card>
    </div>
  );
}

export default function OwnerPortal() {
  const { me } = useMe();
  return (
    <div className="mx-auto min-h-dvh max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between"><span className="font-semibold">{me?.activeOrg?.name} · Owner portal</span><NotificationBell /></header>
      <Routes><Route index element={<Summary />} /><Route path="statements/:id" element={<PortalStatement />} /></Routes>
    </div>
  );
}
```
`PortalStatement.tsx`: `useApi('/v1/portal/statements/:id', StatementDetail)` → heading + `FiguresView` + PDF link.

Router: `{ path: '/owner/*', element: <Suspense fallback={<Spinner />}><OwnerPortal /></Suspense> }` with `const OwnerPortal = lazy(() => import('./features/portal/OwnerPortal'))`.

`e2e/e06-owner-statement.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { lastEmailTo, resetDb } from './fixtures';
import { createUnit, onboardOperator } from './helpers';

test.beforeAll(() => resetDb());

test('E2E-06 finalise an owner statement; owner downloads it and cannot see other owners', async ({ page, browser }) => {
  const admin = await onboardOperator(page, browser, 'tanu-own');
  await createUnit(admin, { property: 'The Rock', unit: 'Kairo', rateNaira: '200000' });
  await createUnit(admin, { property: 'Ocean View', unit: 'Lumina', rateNaira: '150000' });
  const units = (await (await admin.request.get('/v1/units')).json()).items as { id: string; name: string }[];
  const kairo = units.find((u) => u.name === 'Kairo')!.id; const lumina = units.find((u) => u.name === 'Lumina')!.id;
  const me = await (await admin.request.post('/v1/owners', { data: { name: 'Mrs Adebayo', email: 'owner@tanu-own.test', phone: '+2348030000009' } })).json();
  const other = await (await admin.request.post('/v1/owners', { data: { name: 'Mr Other' } })).json();
  const monthStart = new Date().toISOString().slice(0, 7) + '-01';
  await admin.request.post(`/v1/units/${kairo}/owner`, { data: { mode: 'owner', ownerId: me.id, effectiveFrom: monthStart } });
  await admin.request.post(`/v1/units/${lumina}/owner`, { data: { mode: 'owner', ownerId: other.id, effectiveFrom: monthStart } });
  const guest = await (await admin.request.post('/v1/guests', { data: { fullName: 'Ada Guest', phoneE164: '+2348030000001' } })).json();
  await admin.request.post('/v1/bookings', { data: { unitId: kairo, guestId: guest.id, checkIn: monthStart, checkOut: monthStart.replace(/-01$/, '-03'), guestCount: 1, source: 'phone', status: 'confirmed' } });
  await admin.request.post(`/v1/owners/${me.id}/invite`);
  // admin finalises
  await admin.goto(`/statements?period=${monthStart}`);
  await admin.getByRole('button', { name: 'Generate drafts' }).click();
  await admin.getByRole('cell', { name: 'Mrs Adebayo' }).click();
  admin.once('dialog', (d) => d.accept());
  await admin.getByRole('button', { name: 'Finalise' }).click();
  await expect(admin.getByRole('button', { name: 'Download PDF' })).toBeVisible();
  // owner accepts invite and sees only their statement
  const url = /(http\S+\/auth\/accept-invite\/\S+)/.exec((await lastEmailTo('owner@tanu-own.test'))!.text)![1]!;
  const ctx = await browser.newContext(); const owner = await ctx.newPage();
  await owner.goto(url); await owner.getByLabel('Your name').fill('Mrs Adebayo'); await owner.getByLabel('Password').fill('correct-horse-battery');
  await owner.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(owner).toHaveURL(/\/owner$/);
  await expect(owner.getByText('Kairo')).toBeVisible();
  await expect(owner.getByText('Lumina')).toHaveCount(0);
  const [download] = await Promise.all([owner.waitForEvent('download'), owner.getByRole('link', { name: /^Download / }).click()]);
  expect(download.suggestedFilename()).toMatch(/-S-\d{4}-\d{2}-\d{3}\.pdf$/);
});
```
(The PDF redirect points at a `MemoryStorage` URL in E2E; extend the E2E shim from T-M6-06: `MemoryStorage.presignGet` returns `${API_PUBLIC_ORIGIN}/v1/__test/download/<key>?filename=<name>` and `TestSupportController` serves the bytes with `content-disposition: attachment`.)

- [ ] **Step 4:** PASS (unit + E2E-06). **Step 5: Commit** `git commit -m "feat(app): owner portal with occupancy, upcoming stays and statements; E2E-06 [OWN-08]"`

---

## Self-review notes (completed)
- Coverage: OWN-01 (T4, T8), OWN-02 (T1 allocate, T4, T8), OWN-03 (T1 recognise, T5 loader), OWN-04 (T1 compute, T5, T8 FiguresView), OWN-05 (T3 trigger, T6 finalise/paid, T8), OWN-06 (T6 monthly job), OWN-07 (T1 owner-on-date, T5), OWN-08 (T7, T9), OWN-09 (T5 outstanding, T6 PDF note, T8). Reconciliation suite (TESTING.md #5) in T5.
- Known v1 limitation (documented in Global Constraints): fee config is the current one, not historic.
- Names: `recognise`, `allocate`, `computeStatement`, `ownedDuring`, `feeLabel`, `StatementInputsLoader.load`, `nextMonth`, `StatementsService.generateIn/detailIn/pdfUrl/revenueForOrg`, `renderStatement`, `PortalService`. E2E storage shim extended for downloads.
