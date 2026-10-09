import { describe, expect, it } from 'vitest';
import { assertKobo, formatNaira, pctOfBps, sumKobo, toKobo } from './money';

describe('money', () => {
  it('converts naira to kobo exactly', () => {
    expect(toKobo(200000)).toBe(20_000_000);
    expect(toKobo(0.1)).toBe(10);
    expect(toKobo(19.99)).toBe(1999);
  });
  it('rounds naira with float noise half away from zero', () => {
    expect(toKobo(1.005)).toBe(101);
    expect(toKobo(1.255)).toBe(126);
    expect(toKobo(-1.005)).toBe(-101);
  });
  it('refuses naira that cannot become safe kobo', () => {
    expect(() => toKobo(NaN)).toThrow('kobo must be a safe integer');
    expect(() => toKobo(Infinity)).toThrow('kobo must be a safe integer');
    expect(() => toKobo(1e15)).toThrow('kobo must be a safe integer');
  });
  it('formats kobo as naira with en-NG grouping', () => {
    expect(formatNaira(20_000_000)).toBe('₦200,000');
    expect(formatNaira(1999)).toBe('₦19.99');
    expect(formatNaira(-50_000)).toBe('-₦500');
    expect(formatNaira(0)).toBe('₦0');
  });
  it('shows two decimals whenever there are kobo', () => {
    expect(formatNaira(150)).toBe('₦1.50');
    expect(formatNaira(10)).toBe('₦0.10');
    expect(formatNaira(-12_345_670)).toBe('-₦123,456.70');
  });
  it('takes a basis-point percentage rounding half up', () => {
    expect(pctOfBps(10_000, 1500)).toBe(1500); // 15% of ₦100
    expect(pctOfBps(333, 5000)).toBe(167); // 166.5 -> 167
    expect(pctOfBps(1, 5000)).toBe(1); // 0.5 -> 1
    expect(pctOfBps(-333, 5000)).toBe(-167); // symmetric for negatives
  });
  it('refuses basis points that are not an integer in 0..10000', () => {
    expect(() => pctOfBps(1000, NaN)).toThrow('bps must be an integer from 0 to 10000');
    expect(() => pctOfBps(1000, 1.5)).toThrow('bps must be an integer from 0 to 10000');
    expect(() => pctOfBps(1000, -1)).toThrow('bps must be an integer from 0 to 10000');
    expect(() => pctOfBps(1000, 10_001)).toThrow('bps must be an integer from 0 to 10000');
    expect(pctOfBps(1000, 10_000)).toBe(1000);
  });
  it('sums kobo and rejects non-integers', () => {
    expect(sumKobo([1, 2, 3])).toBe(6);
    expect(() => assertKobo(1.5)).toThrow('kobo must be a safe integer');
    expect(() => sumKobo([1, 0.5])).toThrow();
  });
});
