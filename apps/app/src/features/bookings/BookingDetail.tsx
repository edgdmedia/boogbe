import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { SOURCE_LABELS, STATUS_LABELS } from '@boogbe/shared';
import { Badge, Button, Card, CardHeader, Dialog, PageHeader, Spinner } from '@boogbe/ui';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { EditBookingForm } from './EditBookingDialog';
import { HoldCountdown } from './HoldCountdown';
import { useBooking } from './hooks';
import { PriceBreakdown } from './PriceBreakdown';
import { StatusActions } from './StatusActions';
import { WebsiteBadge } from './WebsiteBadge';

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
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="xl:col-span-2">
        <PageHeader
          title={b.ref}
          back={
            <Link to="/bookings" aria-label="Back to bookings" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand">
              <ChevronLeft size={16} aria-hidden />
              Bookings
            </Link>
          }
          meta={
            <>
              <Badge tone={TONE[b.status]}>{STATUS_LABELS[b.status]}</Badge>
              <WebsiteBadge source={b.source} />
              {b.status === 'tentative' && b.holdUntil && <HoldCountdown holdUntil={b.holdUntil} />}
            </>
          }
          actions={
            <>
              <StatusActions booking={b} onChanged={() => mutate()} />
              {editable && (
                <Button variant="secondary" onClick={() => setEdit(true)}>
                  Edit
                </Button>
              )}
            </>
          }
        />
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        <Card className="flex flex-col gap-2">
          <p className="text-[17px] font-bold">
            <Link to={`/guests/${b.guest.id}`} className="text-brand">
              {b.guest.fullName}
            </Link>{' '}
            · {b.guest.phoneE164}
          </p>
          <p className="text-sm">
            {b.unit.name} ({b.unit.propertyName}) · {formatDate(b.checkIn)} → {formatDate(b.checkOut)} · {b.nights} night
            {b.nights === 1 ? '' : 's'} · {b.guestCount} guests · via {SOURCE_LABELS[b.source]}
          </p>
          {b.notes && <p className="text-sm text-ink-muted">{b.notes}</p>}
        </Card>
        {BOOKING_PANELS.map((Panel, i) => (
          <Panel key={i} booking={b} refresh={() => mutate()} />
        ))}
        <Card>
          <CardHeader title="History" />
          <ol className="relative ml-2 flex flex-col gap-3 border-l border-line pl-4 text-sm">
            {b.history.map((h, i) => (
              <li key={i} className="relative before:absolute before:-left-[21px] before:top-1.5 before:size-2 before:rounded-full before:bg-brand">
                {new Date(h.at).toLocaleString('en-NG')} — {STATUS_LABELS[h.to]}
                {h.actorName && ` by ${h.actorName}`}
                {h.reason && ` (${h.reason === 'hold_expired' ? 'hold expired' : h.reason})`}
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <Card className="h-fit">
        <CardHeader title="Price" />
        {b.priceStale && (
          <div role="status" className="mb-3 rounded-control border border-warning/25 bg-[color-mix(in_srgb,var(--color-warning)_8%,var(--color-surface))] p-3 text-sm text-warning">
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
