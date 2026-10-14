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
  it('custom shares ignore units outside the selection', () => {
    expect(() => allocate(1000, units, 'custom', { a: 5000, b: 3000, z: 2000 })).toThrow('Shares must add up to 100%');
  });
  it('refuses negative or fractional shares', () => {
    expect(() => allocate(1000, units, 'custom', { a: 6000, b: 5000, c: -1000 })).toThrow('Shares must be whole basis points from 0 to 10000');
    expect(() => allocate(1000, units, 'custom', { a: 5000.5, b: 2999.5, c: 2000 })).toThrow('Shares must be whole basis points from 0 to 10000');
  });
  it('never gives leftover kobo to a unit with a 0% share', () => {
    expect(allocate(100, units, 'custom', { a: 0, b: 3333, c: 6667 })).toEqual([
      { unitId: 'a', shareBps: 0, amountKobo: 0 }, { unitId: 'b', shareBps: 3333, amountKobo: 34 }, { unitId: 'c', shareBps: 6667, amountKobo: 66 },
    ]);
  });
  it('needs at least one unit', () => {
    expect(() => allocate(1000, [], 'equal')).toThrow('Choose at least one unit');
  });
  it('a single unit takes the whole amount', () => {
    expect(allocate(999, [{ unitId: 'a', sortOrder: 0 }], 'equal')).toEqual([{ unitId: 'a', shareBps: 10_000, amountKobo: 999 }]);
  });
  it('orders by sort order, not by unit id', () => {
    expect(allocate(5, [{ unitId: 'a', sortOrder: 2 }, { unitId: 'z', sortOrder: 1 }], 'equal').map((x) => [x.unitId, x.amountKobo])).toEqual([['z', 3], ['a', 2]]);
  });
  it('ties on sort order fall back to unit id', () => {
    expect(allocate(5, [{ unitId: 'y', sortOrder: 0 }, { unitId: 'x', sortOrder: 0 }], 'equal').map((x) => [x.unitId, x.amountKobo])).toEqual([['x', 3], ['y', 2]]);
  });
  it('refuses a non-kobo amount', () => {
    expect(() => allocate(10.5, units, 'equal')).toThrow('kobo must be a safe integer');
  });
  it('always sums to the expense amount', () => {
    for (const amt of [1, 7, 999_999, 12_345_678]) {
      expect(allocate(amt, units, 'equal').reduce((s, x) => s + x.amountKobo, 0)).toBe(amt);
      expect(allocate(amt, units, 'custom', { a: 3333, b: 3333, c: 3334 }).reduce((s, x) => s + x.amountKobo, 0)).toBe(amt);
    }
  });
  it('equal shares across seven units still sum to 100%', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ unitId: `u${i}`, sortOrder: i }));
    expect(allocate(100, seven, 'equal').reduce((s, x) => s + x.shareBps, 0)).toBe(10_000);
  });
});
