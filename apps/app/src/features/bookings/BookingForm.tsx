import { useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { Booking, BookingSourceEnum, can, QuoteResponse, SOURCE_LABELS, Unit, type Guest } from '@boogbe/shared';
import { Button, Field, Input, Select, Spinner } from '@boogbe/ui';
import { api, ApiError, useApi } from '../../lib/api';
import { useMe } from '../../lib/use-me';
import { GuestPicker } from '../guests/GuestPicker';
import { MoneyInput } from '../inventory/money-input';
import { bookingErrorMessage } from './errors';
import { PriceBreakdown } from './PriceBreakdown';

export function BookingForm({
  unitId,
  checkIn,
  checkOut,
  onCreated,
}: {
  unitId?: string;
  checkIn?: string;
  checkOut?: string;
  onCreated: (b: Booking) => void;
}) {
  const { me } = useMe();
  const role = me?.activeOrg?.role;
  const { data: units } = useApi('/v1/units', z.object({ items: z.array(Unit.pick({ id: true, name: true, maxGuests: true })) }));
  const [v, setV] = useState({
    unitId: unitId ?? '',
    checkIn: checkIn ?? '',
    checkOut: checkOut ?? '',
    guestCount: 2,
    source: 'whatsapp' as z.infer<typeof BookingSourceEnum>,
    status: 'tentative' as 'tentative' | 'confirmed',
    notes: '',
  });
  const [guest, setGuest] = useState<Guest | null>(null);
  const [q, setQ] = useState<QuoteResponse | null>(null);
  const [override, setOverride] = useState<{ on: boolean; totalKobo: number; reason: string }>({ on: false, totalKobo: 0, reason: '' });
  const [warnings, setWarnings] = useState<{ summary: string }[] | null>(null);
  const [ack, setAck] = useState(false);
  const [capReason, setCapReason] = useState<string | null>(null);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!v.unitId || !v.checkIn || !v.checkOut || v.checkOut <= v.checkIn) {
      setQ(null);
      return;
    }
    const t = setTimeout(
      () =>
        api('/v1/bookings/quote', {
          method: 'POST',
          body: { unitId: v.unitId, checkIn: v.checkIn, checkOut: v.checkOut, guestCount: v.guestCount },
          schema: QuoteResponse,
        })
          .then((r) => {
            setQ(r);
            setOverride((o) => (o.on ? o : { ...o, totalKobo: r.finalTotalKobo }));
          })
          .catch(() => setQ(null)),
      300,
    );
    return () => clearTimeout(t);
  }, [v.unitId, v.checkIn, v.checkOut, v.guestCount]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(undefined);
    if (!guest) return setErr('Choose or add a guest');
    if (override.on && override.reason.trim().length < 3) return setErr('Give a reason for changing the price');
    setBusy(true);
    try {
      const b = await api('/v1/bookings', {
        method: 'POST',
        schema: Booking,
        body: {
          unitId: v.unitId,
          checkIn: v.checkIn,
          checkOut: v.checkOut,
          guestCount: v.guestCount,
          guestId: guest.id,
          source: v.source,
          status: v.status,
          notes: v.notes || null,
          ...(override.on && { finalTotalKobo: override.totalKobo, overrideReason: override.reason }),
          ...(ack && { acknowledgeIcalOverlap: true }),
          ...(capReason && { capacityOverrideReason: capReason }),
        },
      });
      onCreated(b);
    } catch (x) {
      if (x instanceof ApiError && x.code === 'ICAL_OVERLAP') setWarnings((x.details as { warnings: { summary: string }[] }).warnings);
      else if (x instanceof ApiError && x.code === 'CAPACITY_EXCEEDED' && role === 'admin') {
        setCapReason('');
        setErr(x.message);
      } else setErr(x instanceof ApiError ? bookingErrorMessage(x) : (x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!units) return <Spinner />;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Unit">
          <Select value={v.unitId} onChange={(e) => setV({ ...v, unitId: e.target.value })}>
            <option value="">Choose…</option>
            {units.items.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Guests">
          <Input type="number" min={1} value={v.guestCount} onChange={(e) => setV({ ...v, guestCount: Number(e.target.value) })} />
        </Field>
        <Field label="Check-in">
          <Input type="date" value={v.checkIn} onChange={(e) => setV({ ...v, checkIn: e.target.value })} />
        </Field>
        <Field label="Check-out">
          <Input type="date" value={v.checkOut} onChange={(e) => setV({ ...v, checkOut: e.target.value })} />
        </Field>
        <Field label="Booked via">
          <Select value={v.source} onChange={(e) => setV({ ...v, source: e.target.value as typeof v.source })}>
            {/* Website bookings only come from the public booking API, never the front desk. */}
            {BookingSourceEnum.options
              .filter((s) => s !== 'website')
              .map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
          </Select>
        </Field>
        <fieldset className="flex items-end gap-4 text-sm">
          <legend className="sr-only">Status</legend>
          <label className="flex items-center gap-1">
            <input type="radio" checked={v.status === 'tentative'} onChange={() => setV({ ...v, status: 'tentative' })} />
            Tentative (hold)
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={v.status === 'confirmed'} onChange={() => setV({ ...v, status: 'confirmed' })} />
            Confirmed
          </label>
        </fieldset>
      </div>
      {q && !q.available && (
        <p role="alert" className="text-sm text-danger">
          {q.conflict?.kind === 'block' ? 'Those dates are blocked for this unit.' : 'Those dates are already booked for this unit.'}
        </p>
      )}
      {q && q.available && (
        <div className="rounded-lg bg-surface-2 p-3">
          <PriceBreakdown lines={q.lines} totalKobo={override.on ? override.totalKobo : q.finalTotalKobo} depositKobo={q.depositKobo} />
          {role && can(role, 'bookings.override') && (
            <div className="mt-3 flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={override.on}
                  onChange={(e) => setOverride({ ...override, on: e.target.checked, totalKobo: q.finalTotalKobo })}
                />
                Change total (agreed price)
              </label>
              {override.on && (
                <div className="grid gap-2 md:grid-cols-2">
                  <Field label="Agreed total">
                    <MoneyInput value={override.totalKobo} onChange={(k) => setOverride({ ...override, totalKobo: k })} />
                  </Field>
                  <Field label="Reason">
                    <Input value={override.reason} onChange={(e) => setOverride({ ...override, reason: e.target.value })} placeholder="e.g. Returning guest" />
                  </Field>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {v.guestCount > (units.items.find((u) => u.id === v.unitId)?.maxGuests ?? 99) && (
        <p className="text-sm text-warning">More guests than this unit sleeps.</p>
      )}
      <GuestPicker value={guest} onChange={setGuest} />
      <Field label="Notes">
        <Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </Field>
      {warnings && (
        <div role="alert" className="rounded-lg border border-warning bg-warning/10 p-3 text-sm">
          <p className="font-medium">Another channel shows these dates as taken:</p>
          <ul className="ml-4 list-disc">
            {warnings.map((w, i) => (
              <li key={i}>{w.summary}</li>
            ))}
          </ul>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            I&apos;ve checked — this booking is not on the other channel
          </label>
        </div>
      )}
      {capReason !== null && (
        <Field label="Why allow more guests?">
          <Input value={capReason} onChange={(e) => setCapReason(e.target.value)} />
        </Field>
      )}
      {err && (
        <p role="alert" className="text-sm text-danger">
          {err}
        </p>
      )}
      <Button type="submit" loading={busy} disabled={!!q && !q.available}>
        Save booking
      </Button>
    </form>
  );
}
