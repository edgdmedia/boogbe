import type { ApiError } from '../../lib/api';

export function bookingErrorMessage(e: ApiError): string {
  if (e.code === 'DATES_UNAVAILABLE') {
    return (e.details as { kind?: string } | undefined)?.kind === 'block'
      ? 'Those dates are blocked for this unit.'
      : 'Those dates are already booked for this unit.';
  }
  return e.message;
}
