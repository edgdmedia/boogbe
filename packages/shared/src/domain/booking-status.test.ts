import { describe, expect, it } from 'vitest';
import { canTransition, nextStatuses } from './booking-status';

describe('booking status [BKG-07]', () => {
  it('allows the documented transitions', () => {
    expect(nextStatuses('tentative')).toEqual(['confirmed', 'cancelled']);
    expect(nextStatuses('confirmed')).toEqual(['checked_in', 'cancelled', 'no_show']);
    expect(nextStatuses('checked_in')).toEqual(['checked_out']);
    expect(nextStatuses('checked_out')).toEqual([]);
    expect(nextStatuses('cancelled')).toEqual([]);
    expect(nextStatuses('no_show')).toEqual([]);
  });
  it('refuses skipping steps', () => {
    expect(canTransition('tentative', 'checked_in')).toBe(false);
    expect(canTransition('checked_in', 'cancelled')).toBe(false);
  });
});
