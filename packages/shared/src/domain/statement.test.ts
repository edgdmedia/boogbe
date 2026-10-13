import { describe, expect, it } from 'vitest';
import type { FeeConfig } from '../contracts/inventory';
import { effectiveFeeConfig } from './fees';
import { sumKobo } from './money';
import { ownerOn, type OwnershipPeriod } from './ownership';
import { inMonth, recognise, type RevenueEntry } from './revenue';
import { computeStatement, feeLabel, fixedFeeShares, ownedDuring, type StatementInput } from './statement';

const gross20: FeeConfig = { feeType: 'pct_gross', feeBps: 2000, feeFixedMonthlyKobo: 0 };
const rev = (unitId: string, date: string, amountKobo: number, ref = 'R'): RevenueEntry => ({ unitId, date, amountKobo, bookingId: ref, ref, source: 'stay' });

const base = (o: Partial<StatementInput> = {}): StatementInput => ({
  ownerId: 'o1', period: '2026-10-01',
  units: [{ unitId: 'u1', unitName: 'Kairo', propertyName: 'Rock', fee: gross20 }],
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
  it('pct_gross plus fixed monthly fee', () => {
    const s = computeStatement(base({ units: [{ unitId: 'u1', unitName: 'Kairo', propertyName: 'Rock', fee: { feeType: 'pct_gross', feeBps: 1500, feeFixedMonthlyKobo: 2_500_000 } }] }));
    expect(s).toMatchObject({ feeKobo: 6_000_000, fixedFeeKobo: 2_500_000, netPayoutKobo: 40_000_000 - 5_000_000 - 6_000_000 - 2_500_000 });
  });
  it('pct_net: fee on gross minus expenses', () => {
    const s = computeStatement(base({ units: [{ unitId: 'u1', unitName: 'Kairo', propertyName: 'Rock', fee: { feeType: 'pct_net', feeBps: 2000, feeFixedMonthlyKobo: 0 } }] }));
    expect(s).toMatchObject({ feeKobo: 7_000_000, netPayoutKobo: 40_000_000 - 5_000_000 - 7_000_000 });
  });
  it('pct_net never negative; negative payout carries forward', () => {
    const s = computeStatement(base({
      units: [{ unitId: 'u1', unitName: 'Kairo', propertyName: 'Rock', fee: { feeType: 'pct_net', feeBps: 2000, feeFixedMonthlyKobo: 1_000_000 } }],
      expenses: [{ expenseId: 'e', unitId: 'u1', date: '2026-10-12', category: 'repairs', description: 'Inverter', amountKobo: 50_000_000 }],
      openingBalanceKobo: -3_000_000,
    }));
    expect(s).toMatchObject({ feeKobo: 0, fixedFeeKobo: 1_000_000, openingBalanceKobo: -3_000_000, netPayoutKobo: 40_000_000 - 50_000_000 - 1_000_000 - 3_000_000 });
  });
  it('pct_gross fee is never negative when refunds outweigh revenue', () => {
    const s = computeStatement(base({ revenue: [rev('u1', '2026-10-10', 1_000_000), rev('u1', '2026-10-11', -4_000_000)], expenses: [] }));
    expect(s).toMatchObject({ grossKobo: -3_000_000, feeKobo: 0, netPayoutKobo: -3_000_000 });
  });
  it('no commission, fixed fee only', () => {
    const s = computeStatement(base({ units: [{ unitId: 'u1', unitName: 'Kairo', propertyName: 'Rock', fee: { feeType: 'none', feeBps: 0, feeFixedMonthlyKobo: 5_000_000 } }] }));
    expect(s).toMatchObject({ feeKobo: 0, fixedFeeKobo: 5_000_000, netPayoutKobo: 40_000_000 - 5_000_000 - 5_000_000 });
  });
  it('rounds fee half-up per unit', () => {
    const s = computeStatement(base({ revenue: [{ unitId: 'u1', date: '2026-10-10', amountKobo: 333, bookingId: 'b', ref: 'R', source: 'stay' }], expenses: [], units: [{ unitId: 'u1', unitName: 'K', propertyName: 'P', fee: { feeType: 'pct_gross', feeBps: 5000, feeFixedMonthlyKobo: 0 } }] }));
    expect(s.feeKobo).toBe(167);
  });
  it('rounds each unit separately and the total is the sum of unit fees', () => {
    const half: FeeConfig = { feeType: 'pct_gross', feeBps: 5000, feeFixedMonthlyKobo: 0 };
    const s = computeStatement(base({
      units: [{ unitId: 'u1', unitName: 'A', propertyName: 'P', fee: half }, { unitId: 'u2', unitName: 'B', propertyName: 'P', fee: half }],
      ownership: { u1: [{ ownerId: 'o1', from: '2026-01-01', to: null }], u2: [{ ownerId: 'o1', from: '2026-01-01', to: null }] },
      revenue: [rev('u1', '2026-10-10', 333), rev('u2', '2026-10-10', 333)], expenses: [],
    }));
    expect(s.units.map((u) => u.feeKobo)).toEqual([167, 167]);
    expect(s.feeKobo).toBe(334);
    expect(s.netPayoutKobo).toBe(666 - 334);
  });
  it('unit fee override applies to that unit only', () => {
    const property: FeeConfig = gross20;
    const s = computeStatement(base({
      units: [
        { unitId: 'u1', unitName: 'A', propertyName: 'Rock', fee: effectiveFeeConfig(property, { feeOverride: false, feeType: 'none', feeBps: 0, feeFixedMonthlyKobo: 0 }) },
        { unitId: 'u2', unitName: 'B', propertyName: 'Rock', fee: effectiveFeeConfig(property, { feeOverride: true, feeType: 'pct_net', feeBps: 1250, feeFixedMonthlyKobo: 5_000_000 }) },
      ],
      ownership: { u1: [{ ownerId: 'o1', from: '2026-01-01', to: null }], u2: [{ ownerId: 'o1', from: '2026-01-01', to: null }] },
      revenue: [rev('u1', '2026-10-10', 10_000_000), rev('u2', '2026-10-10', 10_000_000)],
      expenses: [{ expenseId: 'e', unitId: 'u2', date: '2026-10-12', category: 'diesel', description: 'Diesel', amountKobo: 2_000_000 }],
    }));
    expect(s.units.map((u) => [u.unitName, u.feeLabel, u.feeKobo, u.fixedFeeKobo])).toEqual([
      ['A', '20% of gross', 2_000_000, 0],
      ['B', '12.5% of net + ₦50,000/month', 1_000_000, 5_000_000],
    ]);
    expect(s).toMatchObject({ grossKobo: 20_000_000, expensesKobo: 2_000_000, feeKobo: 3_000_000, fixedFeeKobo: 5_000_000, netPayoutKobo: 20_000_000 - 2_000_000 - 3_000_000 - 5_000_000 });
  });
  it('pct_net uses that unit’s own expenses, not the owner total', () => {
    const net: FeeConfig = { feeType: 'pct_net', feeBps: 1000, feeFixedMonthlyKobo: 0 };
    const s = computeStatement(base({
      units: [{ unitId: 'u1', unitName: 'A', propertyName: 'P', fee: net }, { unitId: 'u2', unitName: 'B', propertyName: 'P', fee: net }],
      ownership: { u1: [{ ownerId: 'o1', from: '2026-01-01', to: null }], u2: [{ ownerId: 'o1', from: '2026-01-01', to: null }] },
      revenue: [rev('u1', '2026-10-10', 10_000_000), rev('u2', '2026-10-10', 10_000_000)],
      expenses: [{ expenseId: 'e', unitId: 'u2', date: '2026-10-12', category: 'repairs', description: 'AC', amountKobo: 30_000_000 }],
    }));
    expect(s.units.map((u) => u.feeKobo)).toEqual([1_000_000, 0]);
  });
  it('ignores revenue and expenses outside the month or for other units', () => {
    const s = computeStatement(base({
      revenue: [rev('u1', '2026-09-30', 1), rev('u1', '2026-10-01', 10), rev('u1', '2026-10-31', 20), rev('u1', '2026-11-01', 1), rev('u9', '2026-10-15', 1)],
      expenses: [
        { expenseId: 'a', unitId: 'u1', date: '2026-09-30', category: 'other', description: 'x', amountKobo: 1 },
        { expenseId: 'b', unitId: 'u9', date: '2026-10-15', category: 'other', description: 'x', amountKobo: 1 },
      ],
    }));
    expect(s).toMatchObject({ grossKobo: 30, expensesKobo: 0 });
  });
  it('lists expenses by date with the unit name', () => {
    const s = computeStatement(base({ expenses: [
      { expenseId: 'b', unitId: 'u1', date: '2026-10-20', category: 'diesel', description: 'Diesel', amountKobo: 2 },
      { expenseId: 'a', unitId: 'u1', date: '2026-10-05', category: 'internet', description: 'Wi-Fi', amountKobo: 1 },
    ] }));
    expect(s.expenses).toEqual([
      { date: '2026-10-05', unitName: 'Kairo', category: 'internet', description: 'Wi-Fi', amountKobo: 1 },
      { date: '2026-10-20', unitName: 'Kairo', category: 'diesel', description: 'Diesel', amountKobo: 2 },
    ]);
  });
  it('shows outstanding balances as a note without deducting them [OWN-09]', () => {
    const outstanding = [{ ref: 'R9', guestName: 'Ada', balanceKobo: 7_000_000 }];
    const s = computeStatement(base({ outstanding }));
    expect(s.outstanding).toEqual(outstanding);
    expect(s.netPayoutKobo).toBe(27_000_000);
  });
  it('refuses a period that is not the first of a month', () => {
    expect(() => computeStatement(base({ period: '2026-10-15' }))).toThrow('Period must be the first day of a month');
    expect(() => computeStatement(base({ period: '2026-10', units: [] }))).toThrow('Period must be the first day of a month');
  });
});

describe('ownership changing mid-month [OWN-07]', () => {
  const handover: OwnershipPeriod[] = [{ ownerId: 'o0', from: '2026-01-01', to: '2026-10-11' }, { ownerId: 'o1', from: '2026-10-11', to: null }];
  it('mid-stay ownership change splits revenue', () => {
    const input = base({ ownership: { u1: handover } });
    const s = computeStatement(input);
    expect(s.grossKobo).toBe(20_000_000);
    expect(computeStatement({ ...input, ownerId: 'o0' }).grossKobo).toBe(20_000_000);
  });
  it('expense only counts if the owner owned the unit on that date', () => {
    const input = base({ ownership: { u1: [{ ownerId: 'o0', from: '2026-01-01', to: '2026-10-13' }, { ownerId: 'o1', from: '2026-10-13', to: null }] } });
    expect(computeStatement(input).expensesKobo).toBe(0);
    expect(computeStatement({ ...input, ownerId: 'o0' }).expensesKobo).toBe(5_000_000);
  });
  it('fixed fee is prorated by days owned and the two parts sum to the full fee [D-024]', () => {
    const fee: FeeConfig = { feeType: 'pct_gross', feeBps: 2000, feeFixedMonthlyKobo: 1_000_000 };
    const input = base({ ownership: { u1: handover }, units: [{ unitId: 'u1', unitName: 'Kairo', propertyName: 'Rock', fee }] });
    const buyer = computeStatement(input).fixedFeeKobo;
    const seller = computeStatement({ ...input, ownerId: 'o0' }).fixedFeeKobo;
    expect([seller, buyer]).toEqual([322_581, 677_419]); // 10 and 21 of 31 days; the spare kobo goes to the larger fraction
    expect(seller + buyer).toBe(1_000_000);
  });
  it('an owner who sold before the month starts gets no line for the unit', () => {
    const s = computeStatement(base({ ownerId: 'o0', ownership: { u1: [{ ownerId: 'o0', from: '2026-01-01', to: '2026-10-01' }, { ownerId: 'o1', from: '2026-10-01', to: null }] } }));
    expect(s.units).toEqual([]);
    expect(s).toMatchObject({ grossKobo: 0, fixedFeeKobo: 0, netPayoutKobo: 0 });
  });
  it('a sale on the 1st leaves the buyer the full fixed fee [D-024]', () => {
    const fee: FeeConfig = { feeType: 'none', feeBps: 0, feeFixedMonthlyKobo: 1_000_000 };
    const s = computeStatement(base({
      units: [{ unitId: 'u1', unitName: 'Kairo', propertyName: 'Rock', fee }],
      ownership: { u1: [{ ownerId: 'o0', from: '2026-01-01', to: '2026-10-01' }, { ownerId: 'o1', from: '2026-10-01', to: null }] },
    }));
    expect(s.fixedFeeKobo).toBe(1_000_000);
  });
  it('days the operator owned the unit are not charged to the owner [D-024]', () => {
    const fee: FeeConfig = { feeType: 'none', feeBps: 0, feeFixedMonthlyKobo: 3_100_000 };
    const s = computeStatement(base({
      units: [{ unitId: 'u1', unitName: 'Kairo', propertyName: 'Rock', fee }],
      ownership: { u1: [{ ownerId: null, from: '2026-01-01', to: '2026-10-21' }, { ownerId: 'o1', from: '2026-10-21', to: null }] },
    }));
    expect(s.fixedFeeKobo).toBe(1_100_000); // 11 of 31 days
  });
  it('an owner who buys on the last day of the month gets that night only', () => {
    const fee: FeeConfig = { feeType: 'pct_gross', feeBps: 2000, feeFixedMonthlyKobo: 1_000_000 };
    const s = computeStatement(base({
      units: [{ unitId: 'u1', unitName: 'Kairo', propertyName: 'Rock', fee }],
      ownership: { u1: [{ ownerId: 'o0', from: '2026-01-01', to: '2026-10-31' }, { ownerId: 'o1', from: '2026-10-31', to: null }] },
      revenue: [rev('u1', '2026-10-30', 100), rev('u1', '2026-10-31', 200)], expenses: [],
    }));
    expect(s).toMatchObject({ grossKobo: 200, feeKobo: 40, fixedFeeKobo: 32_258 });
  });
  it('nights while the operator owned the unit go to no owner', () => {
    const input = base({ ownership: { u1: [{ ownerId: null, from: '2026-01-01', to: '2026-10-11' }, { ownerId: 'o1', from: '2026-10-11', to: null }] } });
    expect(computeStatement(input).grossKobo).toBe(20_000_000);
  });
});

describe('reconciliation: Σ owner gross + operator-owned gross = total recognised', () => {
  it('holds to the kobo across owners, handovers and cross-month stays', () => {
    const ownership: Record<string, OwnershipPeriod[]> = {
      u1: [{ ownerId: 'o0', from: '2026-01-01', to: '2026-10-11' }, { ownerId: 'o1', from: '2026-10-11', to: null }],
      u2: [{ ownerId: 'o1', from: '2026-01-01', to: '2026-10-20' }, { ownerId: null, from: '2026-10-20', to: '2026-10-25' }, { ownerId: 'o2', from: '2026-10-25', to: null }],
      u3: [{ ownerId: null, from: '2026-01-01', to: null }],
    };
    const lines = (accom: number, adj: number) => [
      { kind: 'accommodation' as const, amountKobo: accom, recognition: 'per_night' as const },
      { kind: 'fee' as const, amountKobo: 1_000_001, recognition: 'on_check_in' as const },
      { kind: 'adjustment' as const, amountKobo: adj, recognition: 'per_night' as const },
      { kind: 'deposit' as const, amountKobo: 5_000_000, recognition: 'on_check_in' as const },
    ];
    const b = (id: string, unitId: string, checkIn: string, checkOut: string, accom: number, adj: number) =>
      ({ id, ref: id, unitId, status: 'confirmed' as const, checkIn, checkOut, lines: lines(accom, adj), cancelledOn: null, retainedKobo: 0 });
    const revenue = recognise([
      b('A', 'u1', '2026-09-28', '2026-10-14', 123_456_789, -777_777),
      b('B', 'u2', '2026-10-15', '2026-10-27', 98_765_431, -3),
      b('C', 'u3', '2026-10-05', '2026-10-09', 40_000_001, 0),
      b('D', 'u2', '2026-10-29', '2026-11-04', 77_777_777, -1_234_567),
      { id: 'X', ref: 'X', unitId: 'u1', status: 'cancelled', checkIn: '2026-10-20', checkOut: '2026-10-22', lines: [], cancelledOn: '2026-10-18', retainedKobo: 3_333_333 },
    ], [{ bookingId: 'B', ref: 'B', unitId: 'u2', date: '2026-10-28', amountKobo: 1_500_000 }]);
    const units = ['u1', 'u2', 'u3'].map((unitId) => ({ unitId, unitName: unitId, propertyName: 'P', fee: gross20 }));
    const period = '2026-10-01';
    const owners = ['o0', 'o1', 'o2'];
    const ownerGross = sumKobo(owners.map((ownerId) => computeStatement({ ownerId, period, units, ownership, revenue, expenses: [], openingBalanceKobo: 0, outstanding: [] }).grossKobo));
    const inPeriod = revenue.filter((r) => inMonth(r.date, period));
    const operatorGross = sumKobo(inPeriod.filter((r) => ownerOn(ownership[r.unitId]!, r.date).ownerId === null).map((r) => r.amountKobo));
    expect(operatorGross).toBeGreaterThan(0);
    expect(ownerGross + operatorGross).toBe(sumKobo(inPeriod.map((r) => r.amountKobo)));
  });
});

describe('fixedFeeShares [D-024]', () => {
  it('splits by days owned, operator days included, and sums to the full fee', () => {
    expect(fixedFeeShares(1_000_000, [{ ownerId: 'o0', from: '2026-01-01', to: '2026-10-11' }, { ownerId: null, from: '2026-10-11', to: '2026-10-21' }, { ownerId: 'o1', from: '2026-10-21', to: null }], '2026-10-01')).toEqual([
      { ownerId: 'o0', days: 10, amountKobo: 322_581 }, { ownerId: null, days: 10, amountKobo: 322_580 }, { ownerId: 'o1', days: 11, amountKobo: 354_839 },
    ]);
  });
  it('days with no ownership period count as the operator’s', () => {
    expect(fixedFeeShares(300, [{ ownerId: 'o1', from: '2026-11-11', to: null }], '2026-11-01')).toEqual([
      { ownerId: null, days: 10, amountKobo: 100 }, { ownerId: 'o1', days: 20, amountKobo: 200 },
    ]);
  });
  it('adds up separate stretches for the same owner', () => {
    const shares = fixedFeeShares(1_000_000, [{ ownerId: 'o1', from: '2026-01-01', to: '2026-10-11' }, { ownerId: 'o2', from: '2026-10-11', to: '2026-10-21' }, { ownerId: 'o1', from: '2026-10-21', to: null }], '2026-10-01');
    expect(shares.map((x) => [x.ownerId, x.days])).toEqual([['o1', 21], ['o2', 10]]);
    expect(shares.reduce((t, x) => t + x.amountKobo, 0)).toBe(1_000_000);
  });
  it('gives spare kobo to the largest fractions, earliest owner first on a tie', () => {
    const p = [{ ownerId: 'a', from: '2026-11-01', to: '2026-11-11' }, { ownerId: 'b', from: '2026-11-11', to: '2026-11-21' }, { ownerId: 'c', from: '2026-11-21', to: null }];
    expect(fixedFeeShares(100, p, '2026-11-01').map((x) => x.amountKobo)).toEqual([34, 33, 33]);
    expect(fixedFeeShares(101, p, '2026-11-01').map((x) => x.amountKobo)).toEqual([34, 34, 33]);
  });
  it('uses the length of the month, including February', () => {
    expect(fixedFeeShares(1_000_000, [{ ownerId: 'o1', from: '2027-02-15', to: null }], '2027-02-01').find((x) => x.ownerId === 'o1')).toEqual({ ownerId: 'o1', days: 14, amountKobo: 500_000 });
    expect(fixedFeeShares(2_900_000, [{ ownerId: 'o1', from: '2028-02-01', to: null }], '2028-02-01')).toEqual([{ ownerId: 'o1', days: 29, amountKobo: 2_900_000 }]);
  });
  it('no fixed fee means nothing to share', () => {
    expect(fixedFeeShares(0, [{ ownerId: 'o1', from: '2026-01-01', to: null }], '2026-10-01')).toEqual([{ ownerId: 'o1', days: 31, amountKobo: 0 }]);
  });
  it('always sums to the fee (sweep)', () => {
    for (const fee of [1, 7, 99_999, 1_000_000, 12_345_679]) {
      for (let d = 2; d <= 31; d++) {
        const p = [{ ownerId: 'x', from: '2026-01-01', to: `2026-10-${String(d).padStart(2, '0')}` }, { ownerId: null, from: `2026-10-${String(d).padStart(2, '0')}`, to: null }];
        expect(fixedFeeShares(fee, p, '2026-10-01').reduce((t, x) => t + x.amountKobo, 0)).toBe(fee);
      }
    }
  });
});

describe('ownedDuring', () => {
  const p: OwnershipPeriod[] = [{ ownerId: 'o1', from: '2026-03-15', to: '2026-06-01' }];
  it('is true for any month the owner held the unit at least one day', () => {
    expect(ownedDuring(p, 'o1', '2026-03-01')).toBe(true);
    expect(ownedDuring(p, 'o1', '2026-05-01')).toBe(true);
  });
  it('treats the end date as exclusive', () => {
    expect(ownedDuring(p, 'o1', '2026-06-01')).toBe(false);
    expect(ownedDuring(p, 'o1', '2026-02-01')).toBe(false);
  });
  it('handles December into January', () => {
    expect(ownedDuring([{ ownerId: 'o1', from: '2026-12-31', to: null }], 'o1', '2026-12-01')).toBe(true);
    expect(ownedDuring([{ ownerId: 'o1', from: '2027-01-01', to: null }], 'o1', '2026-12-01')).toBe(false);
  });
  it('is false for another owner', () => {
    expect(ownedDuring(p, 'o2', '2026-04-01')).toBe(false);
  });
});

describe('feeLabel', () => {
  it.each([
    [{ feeType: 'pct_gross', feeBps: 2000, feeFixedMonthlyKobo: 0 }, '20% of gross'],
    [{ feeType: 'pct_net', feeBps: 1250, feeFixedMonthlyKobo: 5_000_000 }, '12.5% of net + ₦50,000/month'],
    [{ feeType: 'none', feeBps: 0, feeFixedMonthlyKobo: 0 }, 'No commission'],
    [{ feeType: 'none', feeBps: 0, feeFixedMonthlyKobo: 1_000_050 }, 'No commission + ₦10,000.50/month'],
  ] as [FeeConfig, string][])('%o → %s', (fee, label) => {
    expect(feeLabel(fee)).toBe(label);
  });
});
