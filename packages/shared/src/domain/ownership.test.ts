import { describe, expect, it } from 'vitest';
import { ownerOn, planOwnerChange, type OwnershipPeriod } from './ownership';

const P = (ownerId: string | null, from: string, to: string | null = null): OwnershipPeriod => ({ ownerId, from, to });

describe('ownerOn', () => {
  const periods = [P('o1', '2026-01-01', '2026-06-01'), P('o2', '2026-06-01')];
  it('finds the owner covering a date (half-open)', () => {
    expect(ownerOn(periods, '2026-05-31')).toEqual({ found: true, ownerId: 'o1' });
    expect(ownerOn(periods, '2026-06-01')).toEqual({ found: true, ownerId: 'o2' });
  });
  it('reports not found before the first period', () => {
    expect(ownerOn(periods, '2025-12-31')).toEqual({ found: false, ownerId: null });
  });
  it('operator-owned is ownerId null but found', () => {
    expect(ownerOn([P(null, '2026-01-01')], '2026-03-01')).toEqual({ found: true, ownerId: null });
  });
});

describe('planOwnerChange', () => {
  it('first assignment inserts', () => {
    expect(planOwnerChange([], 'o1', '2026-10-10')).toEqual({ kind: 'insert', insertFrom: '2026-10-10' });
  });
  it('same owner is a noop', () => {
    expect(planOwnerChange([P('o1', '2026-01-01')], 'o1', '2026-10-10')).toEqual({ kind: 'noop' });
  });
  it('same-day change replaces the period', () => {
    expect(planOwnerChange([P('o1', '2026-10-10')], 'o2', '2026-10-10')).toEqual({ kind: 'replace', from: '2026-10-10' });
  });
  it('later change splits the open period', () => {
    expect(
      planOwnerChange([P('o1', '2026-01-01')], 'o2', '2026-10-10'),
    ).toEqual({ kind: 'split', closeFrom: '2026-01-01', insertFrom: '2026-10-10' });
  });
  it('refuses backdating before the current period start', () => {
    expect(() => planOwnerChange([P('o1', '2026-10-10')], 'o2', '2026-10-01')).toThrow(
      'Ownership can only change on or after 2026-10-10',
    );
  });
});
