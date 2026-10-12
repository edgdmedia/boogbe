import { useState } from 'react';
import { formatNaira, type PaymentEntry } from '@boogbe/shared';
import { Button, Field, Input } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';

export function VoidForm({ bookingId, entry, onSaved }: { bookingId: string; entry: PaymentEntry; onSaved: () => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string>();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/v1/bookings/${bookingId}/payments/void`, { method: 'POST', body: { paymentId: entry.id, reason } });
          onSaved();
        } catch (x) {
          setErr(x instanceof ApiError ? x.message : String(x));
        }
      }}
    >
      <p className="text-sm">
        Void {formatNaira(entry.amountKobo)} recorded on {entry.receivedOn}? It stays in the history, struck through.
      </p>
      <Field label="Reason">
        <Input required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {err && (
        <p role="alert" className="text-sm text-danger">
          {err}
        </p>
      )}
      <Button type="submit" variant="danger">
        Void entry
      </Button>
    </form>
  );
}
