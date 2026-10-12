import { useState } from 'react';
import { z } from 'zod';
import { can, Unit, type Booking } from '@boogbe/shared';
import { Button, Field, Input, Select } from '@boogbe/ui';
import { api, ApiError, useApi } from '../../lib/api';
import { useMe } from '../../lib/use-me';
import { MoneyInput } from '../inventory/money-input';
import { bookingErrorMessage } from './errors';

export function EditBookingForm({ booking, onSaved }: { booking: Booking; onSaved: () => void }) {
  const { me } = useMe();
  const { data: units } = useApi('/v1/units', z.object({ items: z.array(Unit.pick({ id: true, name: true, maxGuests: true })) }));
  const [v, setV] = useState({
    unitId: booking.unit.id,
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
  const totalChanged = v.total !== booking.finalTotalKobo;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(undefined);
        // mirror the server rule (UpdateBookingInput refine): a new total needs a reason
        if (totalChanged && v.reason.trim().length < 3) {
          setErr('Give a reason for changing the total');
          return;
        }
        setBusy(true);
        const body: Record<string, unknown> = { notes: v.notes || null };
        if (v.unitId !== booking.unit.id) body.unitId = v.unitId;
        if (v.checkIn !== booking.checkIn) body.checkIn = v.checkIn;
        if (v.checkOut !== booking.checkOut) body.checkOut = v.checkOut;
        if (v.guestCount !== booking.guestCount) body.guestCount = v.guestCount;
        if (v.reprice) body.reprice = true;
        if (totalChanged) Object.assign(body, { finalTotalKobo: v.total, overrideReason: v.reason });
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
      {units && (
        <Field label="Unit">
          <Select
            value={v.unitId}
            disabled={booking.status === 'checked_in'}
            onChange={(e) => setV({ ...v, unitId: e.target.value })}
          >
            {units.items.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
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
