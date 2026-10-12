import { Booking, BookingSummary, Page } from '@boogbe/shared';
import { useApi } from '../../lib/api';

export const useBooking = (id: string) => useApi(`/v1/bookings/${id}`, Booking);
export const useBookings = (qs: string) => useApi(`/v1/bookings?${qs}`, Page(BookingSummary));
