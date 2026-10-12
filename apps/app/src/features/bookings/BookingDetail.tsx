import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SOURCE_LABELS, STATUS_LABELS } from '@boogbe/shared';
import { Badge, Button, Card, Dialog, Spinner } from '@boogbe/ui';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { EditBookingForm } from './EditBookingDialog';
import { useBooking } from './hooks';
import { PriceBreakdown } from './PriceBreakdown';
import { StatusActions } from './StatusActions';

const TONE = { tentative: 'warning', confirmed: 'info', checked_in: 'success', checked_out: 'neutral', cancelled: 'danger', no_show: 'danger' } as const;

/** Slots let later milestones add panels without editing this file's layout: M3 payments, M5 messages. */
export const BOOKING_PANELS: Array<(p: { booking: NonNullable<ReturnType<typeof useBooking>['data']>; refresh: () => void }) => JSX.Element | null> = [];

export function BookingDetail() {
  const { id = '' } = useParams();
  const { data: b, mutate } = useBooking(id);
  const [edit, setEdit] = useState(false);
  if (!b) return <Spinner />;
  const editable = ['tentative', 'confirmed', 'checked_in'].includes(b.status);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{b.ref}</h1>
            <Badge tone={TONE[b.status]}>{STATUS_LABELS[b.status]}</Badge>
            {b.holdUntil && <span className="text-xs text-ink-muted">Held until {new Date(b.holdUntil).toLocaleString('en-NG')}</span>}
          </div>
          <p>
            <Link to={`/guests/${b.guest.id}`} className="font-medium text-brand">
              {b.guest.fullName}
            </Link>{' '}
            · {b.guest.phoneE164}
          </p>
          <p className="text-sm">
            {b.unit.name} ({b.unit.propertyName}) · {formatDate(b.checkIn)} → {formatDate(b.checkOut)} · {b.nights} night
            {b.nights === 1 ? '' : 's'} · {b.guestCount} guests · via {SOURCE_LABELS[b.source]}
          </p>
          {b.notes && <p className="text-sm text-ink-muted">{b.notes}</p>}
          <div className="flex flex-wrap gap-2 pt-2">
            <StatusActions booking={b} onChanged={() => mutate()} />
            {editable && (
              <Button variant="secondary" onClick={() => setEdit(true)}>
                Edit
              </Button>
            )}
          </div>
        </Card>
        {BOOKING_PANELS.map((Panel, i) => (
          <Panel key={i} booking={b} refresh={() => mutate()} />
        ))}
        <Card>
          <h2 className="mb-2 font-semibold">History</h2>
          <ol className="flex flex-col gap-1 text-sm">
            {b.history.map((h, i) => (
              <li key={i}>
                {new Date(h.at).toLocaleString('en-NG')} — {STATUS_LABELS[h.to]}
                {h.actorName && ` by ${h.actorName}`}
                {h.reason && ` (${h.reason === 'hold_expired' ? 'hold expired' : h.reason})`}
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <Card className="h-fit">
        <h2 className="mb-2 font-semibold">Price</h2>
        {b.priceStale && (
          <div role="status" className="mb-2 rounded bg-warning/10 p-2 text-sm text-warning">
            Dates or guests changed since this price was set.{' '}
            <Button
              variant="ghost"
              onClick={async () => {
                await api(`/v1/bookings/${b.id}`, { method: 'PATCH', body: { reprice: true } });
                await mutate();
              }}
            >
              Reprice
            </Button>
          </div>
        )}
        <PriceBreakdown lines={b.lines} totalKobo={b.finalTotalKobo} depositKobo={b.depositKobo} />
        {b.overrideReason && <p className="mt-2 text-xs text-ink-muted">Price changed: {b.overrideReason}</p>}
      </Card>
      <Dialog open={edit} onClose={() => setEdit(false)} title={`Edit ${b.ref}`}>
        <EditBookingForm
          booking={b}
          onSaved={async () => {
            setEdit(false);
            await mutate();
          }}
        />
      </Dialog>
    </div>
  );
}
