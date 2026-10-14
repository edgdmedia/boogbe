import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, formatNaira, METHOD_LABELS, MoneySummary, monthOf, todayIn } from '@boogbe/shared';
import { Card, EmptyState, Input, Spinner } from '@boogbe/ui';
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Money</h1>
        <Input aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        <Input aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
      </div>
      {!data ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <Card>
              <p className="text-sm text-ink-muted">Received</p>
              <p className="text-2xl font-semibold">{formatNaira(data.totalReceivedKobo)}</p>
              <ul className="mt-2 text-sm">
                {data.receivedByMethod.map((m) => (
                  <li key={m.method} className="flex justify-between">
                    <span>{METHOD_LABELS[m.method]}</span>
                    <span>{formatNaira(m.kobo)}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <p className="text-sm text-ink-muted">Refunded</p>
              <p className="text-2xl font-semibold">{formatNaira(data.refundsKobo)}</p>
            </Card>
            <Card>
              <p className="text-sm text-ink-muted">Caution deposits held</p>
              <p className="text-2xl font-semibold">{formatNaira(data.depositsHeldKobo)}</p>
            </Card>
          </div>
          <Card>
            <h2 className="mb-2 font-semibold">Guests who still owe</h2>
            {data.outstanding.length === 0 ? (
              <EmptyState title="Nobody owes anything" />
            ) : (
              data.outstanding.map((b) => (
                <div key={b.id} className="flex justify-between border-t border-line py-2 text-sm">
                  <span>
                    <Link to={`/bookings/${b.id}`} className="text-brand">
                      {b.ref}
                    </Link>{' '}
                    · {b.guestName} · {b.unitName} · {formatDate(b.checkIn)}
                  </span>
                  <span className="font-medium text-danger">{formatNaira(b.balanceKobo ?? 0)}</span>
                </div>
              ))
            )}
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">Deposits to return</h2>
            {data.depositsToReturn.length === 0 ? (
              <EmptyState title="No deposits waiting" />
            ) : (
              data.depositsToReturn.map((d) => (
                <div key={d.bookingId} className="flex justify-between border-t border-line py-2 text-sm">
                  <span>
                    <Link to={`/bookings/${d.bookingId}`} className="text-brand">
                      {d.ref}
                    </Link>{' '}
                    · {d.guestName} · left {formatDate(d.checkOut)}
                  </span>
                  <span className="font-medium">{formatNaira(d.heldKobo)}</span>
                </div>
              ))
            )}
          </Card>
        </>
      )}
    </div>
  );
}
