import { describe, expect, it } from 'vitest';
import { applyOverride, quote, totals } from './pricing';

const fees = [
  {
    kind: 'caution_deposit' as const,
    label: 'Caution deposit',
    amountKobo: 10_000_000,
    basis: 'per_stay' as const,
    includedGuests: null,
    active: true,
  },
  {
    kind: 'cleaning' as const,
    label: 'Cleaning',
    amountKobo: 1_500_000,
    basis: 'per_stay' as const,
    includedGuests: null,
    active: true,
  },
  {
    kind: 'extra_guest' as const,
    label: 'Extra guest',
    amountKobo: 1_000_000,
    basis: 'per_guest_night' as const,
    includedGuests: 2,
    active: true,
  },
  {
    kind: 'other' as const,
    label: 'Generator',
    amountKobo: 500_000,
    basis: 'per_night' as const,
    includedGuests: null,
    active: true,
  },
  {
    kind: 'other' as const,
    label: 'Old fee',
    amountKobo: 999,
    basis: 'per_stay' as const,
    includedGuests: null,
    active: false,
  },
];

describe('quote [BKG-04]', () => {
  it('prices a 3-night stay for 4 guests', () => {
    const r = quote({
      nightlyRateKobo: 20_000_000,
      fees,
      checkIn: '2026-11-01',
      checkOut: '2026-11-04',
      guestCount: 4,
    });
    expect(r.nights).toBe(3);
    expect(r.lines.map((l) => [l.kind, l.label, l.quantity, l.amountKobo, l.recognition])).toEqual([
      ['accommodation', '3 nights × ₦200,000', 3, 60_000_000, 'per_night'],
      ['fee', 'Cleaning', 1, 1_500_000, 'on_check_in'],
      ['fee', 'Extra guest (2 × 3 nights)', 6, 6_000_000, 'per_night'],
      ['fee', 'Generator', 3, 1_500_000, 'per_night'],
      ['deposit', 'Caution deposit', 1, 10_000_000, 'on_check_in'],
    ]);
    expect(r.computedTotalKobo).toBe(69_000_000);
    expect(r.finalTotalKobo).toBe(69_000_000);
    expect(r.depositKobo).toBe(10_000_000);
  });
  it('omits extra-guest line when within included guests and skips inactive fees', () => {
    const r = quote({
      nightlyRateKobo: 20_000_000,
      fees,
      checkIn: '2026-11-01',
      checkOut: '2026-11-02',
      guestCount: 2,
    });
    expect(r.lines.some((l) => l.label.startsWith('Extra guest'))).toBe(false);
    expect(r.lines.some((l) => l.label === 'Old fee')).toBe(false);
  });
  it('uses singular night', () => {
    expect(
      quote({ nightlyRateKobo: 100, fees: [], checkIn: '2026-11-01', checkOut: '2026-11-02', guestCount: 1 })
        .lines[0]!.label,
    ).toBe('1 night × ₦1');
  });
});

describe('applyOverride [BKG-05]', () => {
  const base = quote({
    nightlyRateKobo: 20_000_000,
    fees,
    checkIn: '2026-11-01',
    checkOut: '2026-11-04',
    guestCount: 2,
  });
  it('adds a negative adjustment for a discount', () => {
    const r = applyOverride(base, 55_000_000);
    expect(r.finalTotalKobo).toBe(55_000_000);
    expect(r.computedTotalKobo).toBe(base.computedTotalKobo);
    expect(r.lines.find((l) => l.kind === 'adjustment')).toMatchObject({
      amountKobo: 55_000_000 - base.computedTotalKobo,
      recognition: 'per_night',
    });
    expect(r.lines.at(-1)!.kind).toBe('deposit'); // the refundable deposit stays last, apart from the total
    expect(totals(r.lines)).toEqual({ totalKobo: 55_000_000, depositKobo: 10_000_000 });
  });
  it('replaces a previous adjustment rather than stacking', () => {
    const r = applyOverride(applyOverride(base, 50_000_000), 52_000_000);
    expect(r.lines.filter((l) => l.kind === 'adjustment')).toHaveLength(1);
    expect(r.finalTotalKobo).toBe(52_000_000);
  });
  it('allows zero, refuses negative', () => {
    expect(applyOverride(base, 0).finalTotalKobo).toBe(0);
    expect(() => applyOverride(base, -1)).toThrow('Total cannot be negative');
  });
  it('override equal to computed removes the adjustment', () => {
    expect(
      applyOverride(applyOverride(base, 1), base.computedTotalKobo).lines.some(
        (l) => l.kind === 'adjustment',
      ),
    ).toBe(false);
  });
});
