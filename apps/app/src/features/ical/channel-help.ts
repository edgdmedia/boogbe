import type { Channel } from '@boogbe/shared';

export const IMPORT_HELP: Record<Channel, string> = {
  airbnb: 'Airbnb: Listings → your listing → Availability → Connect calendars → Export calendar. Copy the link.',
  booking_com: 'Booking.com extranet: Rates & Availability → Sync calendars → Export calendar. Copy the link.',
  vrbo: 'VRBO: Calendar → Import/Export → Export calendar. Copy the link.',
  other: 'Paste the https:// iCal (.ics) export link from the other website.',
};

export const EXPORT_HELP: Record<Channel | 'all', string> = {
  airbnb: 'In Airbnb: Availability → Connect calendars → Import calendar. Paste this link and name it "Boogbe".',
  booking_com: 'In Booking.com extranet: Sync calendars → Import calendar. Paste this link.',
  vrbo: 'In VRBO: Calendar → Import/Export → Import calendar. Paste this link.',
  other: 'Paste this link into the other website\'s "import calendar" setting.',
  all: 'Includes every booking and block. Use it for websites that are not listed above.',
};
