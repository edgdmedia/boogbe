import { useState } from 'react';
import { formatNaira, METHOD_LABELS, nextStatuses, PaymentMethod, STATUS_LABELS, type Booking } from '@boogbe/shared';
import { Button, Dialog, Field, Input, Select } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { MoneyInput } from '../inventory/money-input';
import { useLedger } from '../payments/hooks';
import { bookingErrorMessage } from './errors';

const VERB: Record<string, string> = { confirmed: 'Confirm', checked_in: 'Check in', checked_out: 'Check out', no_show: 'Mark no-show' };

export function StatusActions({ booking, onChanged }: { booking: Booking; onChanged: () => void }) {
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string>();
  const [refundKobo, setRefundKobo] = useState(0);
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('bank_transfer');
  const [refundReference, setRefundReference] = useState('');
  // same SWR key as PaymentsPanel — no extra request when both are on screen
  const { data: ledger } = useLedger(booking.id);
  const netPaid = ledger?.totals.netPaidKobo ?? 0;
  const depositHeld = ledger?.totals.depositHeldKobo ?? 0;
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
            void run(
              api(`/v1/bookings/${booking.id}/cancel`, {
                method: 'POST',
                body: { reason, ...(refundKobo > 0 && { refundKobo, refundMethod, refundReference: refundReference || undefined }) },
              }),
            ).then(() => setCancel(false));
          }}
        >
          <p className="text-sm">The dates become free immediately.</p>
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
          </Field>
          {netPaid > 0 && (
            <>
              <Field label="Refund to guest" hint={`Max ${formatNaira(netPaid)}`}>
                <MoneyInput value={Math.min(refundKobo, netPaid)} onChange={(k) => setRefundKobo(Math.min(k, netPaid))} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Refund method">
                  <Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}>
                    {PaymentMethod.options.filter((m) => m !== 'paystack').map((m) => (
                      <option key={m} value={m}>
                        {METHOD_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Reference">
                  <Input value={refundReference} onChange={(e) => setRefundReference(e.target.value)} />
                </Field>
              </div>
              <p className="text-sm text-ink-muted">Kept by you: {formatNaira(netPaid - refundKobo)}</p>
            </>
          )}
          {depositHeld > 0 && (
            <p className="text-sm text-ink-muted">Caution deposit of {formatNaira(depositHeld)} is still held — return it from the Payments panel.</p>
          )}
          <Button type="submit" variant="danger">
            Cancel booking
          </Button>
        </form>
      </Dialog>
      <span className="sr-only">Current status {STATUS_LABELS[booking.status]}</span>
    </div>
  );
}
