import type { IsoDate } from './dates';

export interface OwnershipPeriod {
  ownerId: string | null;
  from: IsoDate;
  to: IsoDate | null;
}

export type OwnershipPlan =
  | { kind: 'noop' }
  | { kind: 'replace'; from: IsoDate }
  | { kind: 'split'; closeFrom: IsoDate; insertFrom: IsoDate }
  | { kind: 'insert'; insertFrom: IsoDate };

export function ownerOn(periods: OwnershipPeriod[], date: IsoDate) {
  const p = periods.find((x) => x.from <= date && (x.to === null || date < x.to));
  return p ? { found: true, ownerId: p.ownerId } : { found: false, ownerId: null };
}

/** periods: all periods for one unit. Only the open (to === null) period can change. */
export function planOwnerChange(periods: OwnershipPeriod[], ownerId: string | null, effectiveFrom: IsoDate): OwnershipPlan {
  const open = periods.find((p) => p.to === null);
  if (!open) return { kind: 'insert', insertFrom: effectiveFrom };
  if (open.ownerId === ownerId) return { kind: 'noop' };
  if (effectiveFrom < open.from) throw new Error(`Ownership can only change on or after ${open.from}`);
  if (effectiveFrom === open.from) return { kind: 'replace', from: open.from };
  return { kind: 'split', closeFrom: open.from, insertFrom: effectiveFrom };
}
