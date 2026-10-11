import { describe, expect, it } from 'vitest';
import { BlockInput, OwnerInput, UnitFeeInput, UnitInput } from './inventory';

describe('inventory contracts', () => {
  it('owner account number must be a 10-digit NUBAN', () => {
    expect(OwnerInput.safeParse({ name: 'Mrs A', accountNumber: '0123456789' }).success).toBe(true);
    expect(OwnerInput.safeParse({ name: 'Mrs A', accountNumber: '12345' }).success).toBe(false);
  });
  it('unit rate must be positive kobo', () => {
    const base = {
      propertyId: 'p',
      name: 'Kairo',
      bedrooms: 2,
      maxGuests: 4,
      nightlyRateKobo: 20_000_000,
      feeOverride: false,
      feeType: 'none',
      feeBps: 0,
      feeFixedMonthlyKobo: 0,
      defaultAssigneeMemberId: null,
    };
    expect(UnitInput.safeParse(base).success).toBe(true);
    expect(UnitInput.safeParse({ ...base, nightlyRateKobo: 0 }).success).toBe(false);
    expect(UnitInput.safeParse({ ...base, nightlyRateKobo: 1.5 }).success).toBe(false);
  });
  it('extra_guest fee needs includedGuests and per_guest_night; caution deposit is per_stay only', () => {
    expect(
      UnitFeeInput.safeParse({ kind: 'extra_guest', label: 'Extra guest', amountKobo: 1_000_000, basis: 'per_guest_night' })
        .success,
    ).toBe(false);
    expect(
      UnitFeeInput.safeParse({
        kind: 'extra_guest',
        label: 'Extra guest',
        amountKobo: 1_000_000,
        basis: 'per_guest_night',
        includedGuests: 2,
      }).success,
    ).toBe(true);
    expect(
      UnitFeeInput.safeParse({ kind: 'caution_deposit', label: 'Caution', amountKobo: 5_000_000, basis: 'per_night' }).success,
    ).toBe(false);
  });
  it('block end must be after start', () => {
    expect(BlockInput.safeParse({ unitId: 'u', start: '2026-10-10', end: '2026-10-10', reason: 'maintenance' }).success).toBe(false);
  });
});
