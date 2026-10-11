import { describe, expect, it } from 'vitest';
import { effectiveFeeConfig } from './fees';

const prop = { feeType: 'pct_gross' as const, feeBps: 2000, feeFixedMonthlyKobo: 0 };
describe('effectiveFeeConfig', () => {
  it('uses the property config unless the unit overrides', () => {
    expect(effectiveFeeConfig(prop, { feeOverride: false, feeType: 'none', feeBps: 0, feeFixedMonthlyKobo: 0 })).toEqual(prop);
    expect(
      effectiveFeeConfig(prop, { feeOverride: true, feeType: 'pct_net', feeBps: 1500, feeFixedMonthlyKobo: 5_000_000 }),
    ).toEqual({ feeType: 'pct_net', feeBps: 1500, feeFixedMonthlyKobo: 5_000_000 });
  });
});
