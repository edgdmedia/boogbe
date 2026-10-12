import { useState } from 'react';
import { nextStatuses, STATUS_LABELS, type Booking } from '@boogbe/shared';
import { Button, Dialog, Field, Input } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { bookingErrorMessage } from './errors';

const VERB: Record<string, string> = { confirmed: 'Confirm', checked_in: 'Check in', checked_out: 'Check out', no_show: 'Mark no-show' };

export function StatusActions({ booking, onChanged }: { booking: Booking; onChanged: () => void }) {
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string>();
  const run = async (p: Promise<unknown>) => {
    setErr(undefined);
    try {
      await p;
      onChanged();
    } catch (x) {
      setErr(x instanceof ApiError ? bookingErrorMessage(x) : String(x));
    }
  };
  const next = nextStatuses(booking.status);
  return (
    <div className="flex flex-wrap gap-2">
      {next
        .filter((s) => s !== 'cancelled')
        .map((s) => (
          <Button key={s} variant={s === 'no_show' ? 'secondary' : 'primary'} onClick={() => run(api(`/v1/bookings/${booking.id}/transition`, { method: 'POST', body: { to: s } }))}>
            {VERB[s]}
          </Button>
        ))}
      {next.includes('cancelled') && (
        <Button variant="danger" onClick={() => setCancel(true)}>
          Cancel booking
        </Button>
      )}
      {err && (
        <p role="alert" className="w-full text-sm text-danger">
          {err}
        </p>
      )}
      <Dialog open={cancel} onClose={() => setCancel(false)} title={`Cancel ${booking.ref}?`}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(api(`/v1/bookings/${booking.id}/cancel`, { method: 'POST', body: { reason } })).then(() => setCancel(false));
          }}
        >
          <p className="text-sm">The dates become free immediately. Refunds are recorded on the payments panel.</p>
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
          </Field>
          <Button type="submit" variant="danger">
            Cancel booking
          </Button>
        </form>
      </Dialog>
      <span className="sr-only">Current status {STATUS_LABELS[booking.status]}</span>
    </div>
  );
}
