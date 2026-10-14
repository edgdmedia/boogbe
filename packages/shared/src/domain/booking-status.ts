import type { BookingStatus } from '../contracts/calendar';

const NEXT: Record<BookingStatus, BookingStatus[]> = {
  tentative: ['confirmed', 'cancelled'],
  confirmed: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['checked_out'],
  checked_out: [],
  cancelled: [],
  no_show: [],
};
/** Statuses that hold the dates (must match the booking exclusion constraint's WHERE clause). */
export const ACTIVE_STATUSES: readonly BookingStatus[] = ['tentative', 'confirmed', 'checked_in'];
export const STATUS_LABELS: Record<BookingStatus, string> = {
  tentative: 'Tentative',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  checked_out: 'Checked out',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};
export const nextStatuses = (from: BookingStatus) => [...NEXT[from]];
export const canTransition = (from: BookingStatus, to: BookingStatus) => NEXT[from].includes(to);
