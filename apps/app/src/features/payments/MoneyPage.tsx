import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, formatNaira, METHOD_LABELS, MoneySummary, monthOf, todayIn } from '@boogbe/shared';
import { Card, CardHeader, EmptyState, Input, PageHeader, Spinner, StatTile } from '@boogbe/ui';
import { useApi } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useMe } from '../../lib/use-me';

export function MoneyPage() {
  const { me } = useMe();
  const today = todayIn(me?.activeOrg?.timezone ?? 'Africa/Lagos');
  const [from, setFrom] = useState(monthOf(today));
  const [to, setTo] = useState(addDays(today, 1));
  const { data } = useApi(`/v1/money/summary?from=${from}&to=${to}`, MoneySummary);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Money"
        actions={
          <>
            <Input aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            <Input aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </>
        }
      />
      {!data ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <StatTile label="Received" value={formatNaira(data.totalReceivedKobo)}>
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {data.receivedByMethod.map((m) => (
                  <li key={m.method} className="flex justify-between">
                    <span className="text-ink-muted">{METHOD_LABELS[m.method]}</span>
                    <span className="num font-semibold">{formatNaira(m.kobo)}</span>
                  </li>
                ))}
              </ul>
            </StatTile>
            <StatTile label="Refunded" value={formatNaira(data.refundsKobo)} />
            <StatTile label="Caution deposits held" value={formatNaira(data.depositsHeldKobo)} />
          </div>
          <Card>
            <CardHeader title="Guests who still owe" />
            {data.outstanding.length === 0 ? (
              <EmptyState title="Nobody owes anything" />
            ) : (
              data.outstanding.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3 border-t border-line py-3 text-sm first-of-type:border-t-0">
                  <span>
                    <Link to={`/bookings/${b.id}`} className="font-semibold text-brand">
                      {b.ref}
                    </Link>{' '}
                    · {b.guestName} · {b.unitName} · {formatDate(b.checkIn)}
                  </span>
                  <span className="num font-semibold text-danger">{formatNaira(b.balanceKobo ?? 0)}</span>
                </div>
              ))
            )}
          </Card>
          <Card>
            <CardHeader title="Deposits to return" />
            {data.depositsToReturn.length === 0 ? (
              <EmptyState title="No deposits waiting" />
            ) : (
              data.depositsToReturn.map((d) => (
                <div key={d.bookingId} className="flex items-center justify-between gap-3 border-t border-line py-3 text-sm first-of-type:border-t-0">
                  <span>
                    <Link to={`/bookings/${d.bookingId}`} className="font-semibold text-brand">
                      {d.ref}
                    </Link>{' '}
                    · {d.guestName} · left {formatDate(d.checkOut)}
                  </span>
                  <span className="num font-semibold">{formatNaira(d.heldKobo)}</span>
                </div>
              ))
            )}
          </Card>
        </>
      )}
    </div>
  );
}
