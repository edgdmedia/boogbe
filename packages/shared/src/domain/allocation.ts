import { assertKobo } from './money';

export interface Allocation { unitId: string; shareBps: number; amountKobo: number }

/** Splits a property-level expense across units (D-016). Remainder kobo goes to the first unit by sort order with a share above 0 so the parts sum exactly. */
export function allocate(amountKobo: number, units: { unitId: string; sortOrder: number }[], method: 'equal' | 'custom', customBps?: Record<string, number>): Allocation[] {
  assertKobo(amountKobo);
  if (!units.length) throw new Error('Choose at least one unit');
  const sorted = [...units].sort((a, b) => a.sortOrder - b.sortOrder || a.unitId.localeCompare(b.unitId));
  let shares: number[];
  if (method === 'equal') {
    const each = Math.floor(10_000 / sorted.length);
    shares = sorted.map((_, i) => each + (i === 0 ? 10_000 - each * sorted.length : 0));
  } else {
    shares = sorted.map((u) => customBps?.[u.unitId] ?? 0);
    if (shares.some((bps) => !Number.isInteger(bps) || bps < 0 || bps > 10_000)) throw new Error('Shares must be whole basis points from 0 to 10000');
    if (shares.reduce((s, x) => s + x, 0) !== 10_000) throw new Error('Shares must add up to 100%');
  }
  const amounts = method === 'equal'
    ? sorted.map(() => Math.floor(amountKobo / sorted.length))
    : shares.map((bps) => Math.floor((amountKobo * bps) / 10_000));
  // Leftover goes to the first unit that has a share, so a 0% unit is never charged.
  amounts[shares.findIndex((bps) => bps > 0)]! += amountKobo - amounts.reduce((s, x) => s + x, 0);
  return sorted.map((u, i) => ({ unitId: u.unitId, shareBps: shares[i]!, amountKobo: amounts[i]! }));
}
