import type { FeeConfig } from '../contracts/inventory';

export function effectiveFeeConfig(property: FeeConfig, unit: FeeConfig & { feeOverride: boolean }): FeeConfig {
  return unit.feeOverride
    ? { feeType: unit.feeType, feeBps: unit.feeBps, feeFixedMonthlyKobo: unit.feeFixedMonthlyKobo }
    : { ...property };
}
