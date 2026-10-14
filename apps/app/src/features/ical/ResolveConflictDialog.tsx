import { useState } from 'react';
import { formatNaira, METHOD_LABELS, PaymentMethod, type SyncConflict } from '@boogbe/shared';
import { Button, Field, Select } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { MoneyInput } from '../inventory/money-input';
import { useLedger } from '../payments/hooks';

export function CancelForConflictForm({ conflict, onDone }: { conflict: SyncConflict; onDone: () => void }) {
  const { data } = useLedger(conflict.booking.id);
  const [refund, setRefund] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [err, setErr] = useState<string>();
  const paid = data?.totals.netPaidKobo ?? 0;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/v1/ical/conflicts/${conflict.id}/resolve`, {
            method: 'POST',
            body: { action: 'cancel_booking', ...(refund > 0 && { refundKobo: refund, refundMethod: method }) },
          });
          onDone();
        } catch (x) {
          setErr(x instanceof ApiError ? x.message : String(x));
        }
      }}
    >
      <p className="text-sm">The guest has paid {formatNaira(paid)}.</p>
      {paid > 0 && (
        <>
          <Field label="Refund">
            <MoneyInput value={refund} onChange={setRefund} />
          </Field>
          <Field label="Refund method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PaymentMethod.options.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
      {err && (
        <p role="alert" className="text-sm text-danger">
          {err}
        </p>
      )}
      <Button type="submit" variant="danger">
        Cancel booking
      </Button>
    </form>
  );
}
