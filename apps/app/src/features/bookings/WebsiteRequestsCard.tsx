import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { BookingSummary, Page } from '@boogbe/shared';
import { Card } from '@boogbe/ui';
import { api } from '../../lib/api';
import { formatDate, formatNaira } from '../../lib/format';
import { HoldCountdown } from './HoldCountdown';

const PATH = '/v1/bookings?source=website&status=tentative&limit=20';
const expiry = (b: BookingSummary) => (b.holdUntil ? new Date(b.holdUntil).getTime() : Infinity);

/** Open website requests, soonest hold expiry first. Polls like the notification bell; hidden when there are none. */
export function WebsiteRequestsCard() {
  const { data } = useSWR(PATH, (p: string) => api(p, { schema: Page(BookingSummary) }), {
    refreshInterval: 60_000,
  });
  if (!data?.items.length) return null;
  const rows = [...data.items].sort((a, b) => expiry(a) - expiry(b));
  return (
    <Card className="flex flex-col gap-2 border-info">
      <h2 className="font-semibold">New website requests</h2>
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <Link to={`/bookings/${b.id}`} className="font-medium text-brand">
              {b.ref}
            </Link>
            <span>
              {b.unitName} · {formatDate(b.checkIn)} → {formatDate(b.checkOut)} · {b.guestName}
            </span>
            <span>{formatNaira(b.finalTotalKobo)}</span>
            {b.holdUntil && <HoldCountdown holdUntil={b.holdUntil} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}
