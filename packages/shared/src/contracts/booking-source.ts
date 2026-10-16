import { z } from 'zod';

// `BookingSource` is the API's calendar-source interface, so the channel enum is BookingSourceEnum.
export const BookingSourceEnum = z.enum([
  'whatsapp',
  'phone',
  'walk_in',
  'direct',
  'airbnb',
  'booking_com',
  'website',
  'other',
]);
export type BookingSourceValue = z.infer<typeof BookingSourceEnum>;
export const SOURCE_LABELS: Record<BookingSourceValue, string> = {
  whatsapp: 'WhatsApp',
  phone: 'Phone call',
  walk_in: 'Walk-in',
  direct: 'Direct',
  airbnb: 'Airbnb',
  booking_com: 'Booking.com',
  website: 'Website',
  other: 'Other',
};
