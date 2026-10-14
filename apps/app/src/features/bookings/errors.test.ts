import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import { bookingErrorMessage } from './errors';

describe('bookingErrorMessage', () => {
  it('explains conflicts in plain words', () => {
    expect(bookingErrorMessage(new ApiError('DATES_UNAVAILABLE', 'x', 409, { kind: 'booking', id: 'b' }))).toBe(
      'Those dates are already booked for this unit.',
    );
    expect(bookingErrorMessage(new ApiError('DATES_UNAVAILABLE', 'x', 409, { kind: 'block', id: 'b' }))).toBe(
      'Those dates are blocked for this unit.',
    );
    expect(bookingErrorMessage(new ApiError('CAPACITY_EXCEEDED', 'This unit sleeps 4.', 422))).toBe('This unit sleeps 4.');
    expect(bookingErrorMessage(new ApiError('INVALID_TRANSITION', 'A cancelled booking cannot become confirmed', 422))).toBe(
      'A cancelled booking cannot become confirmed',
    );
  });
});
