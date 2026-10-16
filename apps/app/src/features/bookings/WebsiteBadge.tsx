import type { BookingSourceValue } from '@boogbe/shared';
import { Badge } from '@boogbe/ui';

/** Marks bookings that came in through the operator's website. */
export function WebsiteBadge({ source }: { source: BookingSourceValue }) {
  return source === 'website' ? <Badge tone="info">Website</Badge> : null;
}
