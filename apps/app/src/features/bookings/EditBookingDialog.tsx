import { useState } from 'react';
import { can, type Booking } from '@boogbe/shared';
import { Button, Field, Input } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { useMe } from '../../lib/use-me';
import { MoneyInput } from '../inventory/money-input';
import { bookingErrorMessage } from './errors';

export function EditBookingForm({ booking, onSaved }: { booking: Booking; onSaved: () => void }) {
  const { me } = useMe();
  const [v, setV] = useState({
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    guestCount: booking.guestCount,
    notes: booking.notes ?? '',
    reprice: false,
    total: booking.finalTotalKobo,
    reason: '',
  });
  const [err, setErr] = useState<string>();
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const canOverride = !!me?.activeOrg && can(me.activeOrg.role, 'bookings.override');
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(undefined);
        setBusy(true);
        const body: Record<string, unknown> = { notes: v.notes || null };
        if (v.checkIn !== booking.checkIn) body.checkIn = v.checkIn;
        if (v.checkOut !== booking.checkOut) body.checkOut = v.checkOut;
        if (v.guestCount !== booking.guestCount) body.guestCount = v.guestCount;
        if (v.reprice) body.reprice = true;
        if (v.total !== booking.finalTotalKobo) Object.assign(body, { finalTotalKobo: v.total, overrideReason: v.reason });
        if (ack) body.acknowledgeIcalOverlap = true;
        try {
          await api(`/v1/bookings/${booking.id}`, { method: 'PATCH', body });
          onSaved();
        } catch (x) {
          if (x instanceof ApiError && x.code === 'ICAL_OVERLAP') setErr('These dates overlap another channel. Tick the box to confirm.');
          else setErr(x instanceof ApiError ? bookingErrorMessage(x) : String(x));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="Check-in">
          <Input type="date" value={v.checkIn} disabled={booking.status === 'checked_in'} onChange={(e) => setV({ ...v, checkIn: e.target.value })} />
        </Field>
        <Field label="Check-out">
          <Input type="date" value={v.checkOut} onChange={(e) => setV({ ...v, checkOut: e.target.value })} />
        </Field>
      </div>
      <Field label="Guests">
        <Input type="number" min={1} value={v.guestCount} onChange={(e) => setV({ ...v, guestCount: Number(e.target.value) })} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.reprice} onChange={(e) => setV({ ...v, reprice: e.target.checked })} />
        Recalculate price from current rates
      </label>
      {canOverride && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Total">
            <MoneyInput value={v.total} onChange={(k) => setV({ ...v, total: k })} />
          </Field>
          <Field label="Reason (if total changed)">
            <Input value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
          </Field>
        </div>
      )}
      <Field label="Notes">
        <Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </Field>
      {err?.startsWith('These dates overlap') && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          I&apos;ve checked the other channel
        </label>
      )}
      {err && (
        <p role="alert" className="text-sm text-danger">
          {err}
        </p>
      )}
      <Button type="submit" loading={busy}>
        Save changes
      </Button>
    </form>
  );
}
