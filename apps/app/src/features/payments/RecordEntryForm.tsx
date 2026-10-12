import { useState } from 'react';
import {
  ENTRY_LABELS,
  METHOD_LABELS,
  PaymentMethod,
  todayIn,
  validateEntry,
  type BookingLedger,
  type RecordEntryInput,
} from '@boogbe/shared';
import { Button, Field, Input, Select } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { useMe } from '../../lib/use-me';
import { MoneyInput } from '../inventory/money-input';

type Kind = RecordEntryInput['kind'];

export function RecordEntryForm({
  bookingId,
  kinds,
  defaultAmountKobo,
  ledger,
  onSaved,
}: {
  bookingId: string;
  kinds: Kind[];
  defaultAmountKobo: number;
  ledger: BookingLedger;
  onSaved: () => void;
}) {
  const { me } = useMe();
  const [v, setV] = useState({
    kind: kinds[0]!,
    amountKobo: defaultAmountKobo,
    method: 'bank_transfer' as PaymentMethod,
    receivedOn: todayIn(me?.activeOrg?.timezone ?? 'Africa/Lagos'),
    reference: '',
    note: '',
  });
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const local = validateEntry(
    ledger.entries.map((e) => ({ id: e.id, kind: e.kind, amountKobo: e.amountKobo, voidsPaymentId: e.voidsPaymentId })),
    { kind: v.kind, amountKobo: v.amountKobo },
  );
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(undefined);
        if (local) return setErr(local);
        if (v.kind === 'deposit_withheld' && v.note.trim().length < 3) return setErr('Say why the deposit is kept');
        setBusy(true);
        try {
          await api(`/v1/bookings/${bookingId}/payments`, {
            method: 'POST',
            body: { ...v, reference: v.reference || null, note: v.note || null },
          });
          onSaved();
        } catch (x) {
          setErr(x instanceof ApiError ? x.message : String(x));
        } finally {
          setBusy(false);
        }
      }}
    >
      {kinds.length > 1 && (
        <Field label="Type">
          <Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as Kind })}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {ENTRY_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Amount" error={local ?? undefined}>
        <MoneyInput value={v.amountKobo} onChange={(k) => setV({ ...v, amountKobo: k })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Method">
          <Select value={v.method} onChange={(e) => setV({ ...v, method: e.target.value as PaymentMethod })}>
            {PaymentMethod.options
              .filter((m) => m !== 'paystack')
              .map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={v.receivedOn} onChange={(e) => setV({ ...v, receivedOn: e.target.value })} />
        </Field>
      </div>
      <Field label="Reference" hint="Transfer reference or POS slip number">
        <Input value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />
      </Field>
      <Field label={v.kind === 'deposit_withheld' ? 'Reason (required)' : 'Note'}>
        <Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </Field>
      {err && (
        <p role="alert" className="text-sm text-danger">
          {err}
        </p>
      )}
      <Button type="submit" loading={busy}>
        Save
      </Button>
    </form>
  );
}
