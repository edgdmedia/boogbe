import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { STATUS_LABELS, waDigits } from '@boogbe/shared';
import { Badge, Button, Card, CardHeader, Dialog, PageHeader, Spinner } from '@boogbe/ui';
import { formatDate, formatNaira } from '../../lib/format';
import { GuestForm } from './GuestForm';
import { useGuest, useGuestBookings } from './hooks';

export function GuestDetail() {
  const { id = '' } = useParams();
  const { data: g, mutate } = useGuest(id);
  const { data: b } = useGuestBookings(id);
  const [edit, setEdit] = useState(false);
  if (!g) return <Spinner />;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader
        title={g.fullName}
        actions={
          <>
            <a href={`https://wa.me/${waDigits(g.phoneE164)}`} target="_blank" rel="noreferrer">
              <Button variant="secondary">WhatsApp</Button>
            </a>
            <Button variant="secondary" onClick={() => setEdit(true)}>
              Edit
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink-muted">
          {g.phoneE164}
          {g.email && ` · ${g.email}`}
        </p>
        <p className="text-sm text-ink-muted">
          {g.bookingCount} stays · <span className="num font-semibold text-ink">{formatNaira(g.lifetimeValueKobo)}</span> lifetime
        </p>
        {g.notes && <p className="mt-2 text-sm">{g.notes}</p>}
      </div>
      <Card>
        <CardHeader title="Bookings" />
        <div className="flex flex-col">
          {b?.items.map((x) => (
            <Link
              key={x.id}
              to={`/bookings/${x.id}`}
              className="flex min-h-11 items-center justify-between gap-2 border-t border-line py-3 text-sm first:border-t-0 hover:text-brand"
            >
              <span>
                {x.ref} · {x.unitName} · {formatDate(x.checkIn)} → {formatDate(x.checkOut)}
              </span>
              <Badge>{STATUS_LABELS[x.status]}</Badge>
            </Link>
          ))}
        </div>
      </Card>
      <Dialog open={edit} onClose={() => setEdit(false)} title="Edit guest">
        <GuestForm
          initial={g}
          onSaved={async () => {
            setEdit(false);
            await mutate();
          }}
        />
      </Dialog>
    </div>
  );
}
