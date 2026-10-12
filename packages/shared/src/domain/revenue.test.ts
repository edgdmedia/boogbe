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
    expect(sumKobo(e.filter((x) => inMonth(x.date, '2026-11-01')).map((x) => x.amountKobo))).toBe(20_000_000);
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
  it('a discount on check-in lands on the first night only', () => {
    const e = recognise([stay({ lines: [{ kind: 'accommodation', amountKobo: 300, recognition: 'per_night' }, { kind: 'adjustment', amountKobo: -50, recognition: 'on_check_in' }] })], []);
    expect(e.map((x) => x.amountKobo)).toEqual([50, 100, 100]);
  });
  it('a night that nets to zero produces no entry', () => {
    const e = recognise([stay({ lines: [{ kind: 'accommodation', amountKobo: 300, recognition: 'per_night' }, { kind: 'adjustment', amountKobo: -100, recognition: 'on_check_in' }] })], []);
    expect(e.map((x) => x.date)).toEqual(['2026-10-31', '2026-11-01']);
  });
  it('a booking with only a deposit earns nothing', () => {
    expect(recognise([stay({ lines: [{ kind: 'deposit', amountKobo: 5_000, recognition: 'on_check_in' }] })], [])).toEqual([]);
  });
  it.each(['confirmed', 'checked_in', 'checked_out', 'no_show'] as const)('%s earns stay revenue', (status) => {
    expect(sumKobo(recognise([stay({ status })], []).map((x) => x.amountKobo))).toBe(61_500_000);
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
  it('refuses a booking with no nights', () => {
    expect(() => recognise([stay({ checkOut: '2026-10-30' })], [])).toThrow('has no nights');
  });
  it('orders entries by date then booking', () => {
    const e = recognise([
      stay({ id: 'b2', ref: 'R2', checkIn: '2026-10-01', checkOut: '2026-10-02' }),
      stay({ id: 'b1', ref: 'R1', checkIn: '2026-10-01', checkOut: '2026-10-02' }),
    ], []);
    expect(e.map((x) => x.bookingId)).toEqual(['b1', 'b2']);
  });
  it('every stay sums to its non-deposit lines across months (sweep)', () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed % n; };
    for (let k = 0; k < 300; k++) {
      const nights = 1 + rnd(45);
      const checkIn = `2026-${String(1 + rnd(12)).padStart(2, '0')}-${String(1 + rnd(28)).padStart(2, '0')}`;
      const d = new Date(`${checkIn}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + nights);
      const lines: RevenueBooking['lines'] = [
        { kind: 'accommodation', amountKobo: 1 + rnd(900_000_000), recognition: 'per_night' },
        { kind: 'fee', amountKobo: rnd(5_000_000), recognition: rnd(2) ? 'per_night' : 'on_check_in' },
        { kind: 'adjustment', amountKobo: -rnd(3_000_000), recognition: rnd(2) ? 'per_night' : 'on_check_in' },
        { kind: 'deposit', amountKobo: rnd(10_000_000), recognition: 'on_check_in' },
      ];
      const e = recognise([stay({ checkIn, checkOut: d.toISOString().slice(0, 10), lines })], []);
      const expected = sumKobo(lines.filter((l) => l.kind !== 'deposit').map((l) => l.amountKobo));
      expect(sumKobo(e.map((x) => x.amountKobo))).toBe(expected);
      const months = [...new Set(e.map((x) => x.date.slice(0, 7)))];
      expect(sumKobo(months.map((m) => sumKobo(e.filter((x) => inMonth(x.date, `${m}-01`)).map((x) => x.amountKobo))))).toBe(expected);
    }
  });
});

describe('inMonth', () => {
  it('matches dates in the same calendar month only', () => {
    expect(inMonth('2026-10-31', '2026-10-01')).toBe(true);
    expect(inMonth('2026-11-01', '2026-10-01')).toBe(false);
    expect(inMonth('2025-10-15', '2026-10-01')).toBe(false);
  });
});
