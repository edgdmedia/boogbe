import { describe, expect, it } from 'vitest';
import { isLocked } from './lockout';

const now = new Date('2026-10-09T12:00:00Z');
const at = (minAgo: number, success = false) => ({ success, createdAt: new Date(now.getTime() - minAgo * 60_000) });

describe('isLocked', () => {
  it('locks after 5 failures within 15 minutes', () => {
    expect(isLocked([at(1), at(2), at(3), at(4), at(5)], now)).toBe(true);
  });
  it('does not lock on 4 failures', () => {
    expect(isLocked([at(1), at(2), at(3), at(4)], now)).toBe(false);
  });
  it('a success resets the count', () => {
    expect(isLocked([at(1), at(2), at(3, true), at(4), at(5), at(6)], now)).toBe(false);
  });
  it('ignores failures older than 15 minutes', () => {
    expect(isLocked([at(1), at(2), at(3), at(4), at(16)], now)).toBe(false);
  });
});
