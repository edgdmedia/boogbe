import { z } from 'zod';
import { BookingSummary, Guest, Page } from '@boogbe/shared';
import { useApi } from '../../lib/api';

export const useGuests = (q: string) =>
  useApi(`/v1/guests?limit=30${q ? `&q=${encodeURIComponent(q)}` : ''}`, Page(Guest));
export const useGuest = (id: string) => useApi(`/v1/guests/${id}`, Guest);
export const useGuestBookings = (id: string) =>
  useApi(`/v1/guests/${id}/bookings`, z.object({ items: z.array(BookingSummary) }));
