import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { STATUS_LABELS, waDigits } from '@boogbe/shared';
import { Badge, Button, Card, Dialog, Spinner } from '@boogbe/ui';
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
      <Card className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{g.fullName}</h1>
          <p className="text-sm text-ink-muted">
            {g.phoneE164}
            {g.email && ` · ${g.email}`}
          </p>
          <p className="text-sm">
            {g.bookingCount} stays · {formatNaira(g.lifetimeValueKobo)} lifetime
          </p>
          {g.notes && <p className="mt-2 text-sm">{g.notes}</p>}
        </div>
        <div className="flex gap-2">
          <a href={`https://wa.me/${waDigits(g.phoneE164)}`} target="_blank" rel="noreferrer">
            <Button variant="secondary">WhatsApp</Button>
          </a>
          <Button variant="secondary" onClick={() => setEdit(true)}>
            Edit
          </Button>
        </div>
      </Card>
      <h2 className="font-semibold">Bookings</h2>
      {b?.items.map((x) => (
        <Link key={x.id} to={`/bookings/${x.id}`}>
          <Card className="flex items-center justify-between">
            <span>
              {x.ref} · {x.unitName} · {formatDate(x.checkIn)} → {formatDate(x.checkOut)}
            </span>
            <Badge>{STATUS_LABELS[x.status]}</Badge>
          </Card>
        </Link>
      ))}
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
