import { useState } from 'react';
import { UnitFeeInput, type UnitFee } from '@boogbe/shared';
import { Badge, Button, Field, Input, Select } from '@boogbe/ui';
import { api } from '../../lib/api';
import { formatNaira } from '../../lib/format';
import { useUnitFees } from './hooks';
import { MoneyInput } from './money-input';

const BASIS = { per_stay: 'per stay', per_night: 'per night', per_guest_night: 'per extra guest per night' } as const;

export function UnitFees({ unitId, canWrite }: { unitId: string; canWrite: boolean }) {
  const { data, mutate } = useUnitFees(unitId);
  const [draft, setDraft] = useState<UnitFeeInput>({ kind: 'cleaning', label: 'Cleaning fee', amountKobo: 0, basis: 'per_stay', active: true });
  const [err, setErr] = useState<string>();
  const presets: Record<UnitFeeInput['kind'], Partial<UnitFeeInput>> = {
    caution_deposit: { label: 'Caution deposit', basis: 'per_stay', includedGuests: undefined },
    cleaning: { label: 'Cleaning fee', basis: 'per_stay', includedGuests: undefined },
    extra_guest: { label: 'Extra guest', basis: 'per_guest_night', includedGuests: 2 },
    other: { label: 'Other fee', basis: 'per_stay', includedGuests: undefined },
  };
  return (
    <div className="flex flex-col gap-2">
      {data?.items.map((f: UnitFee) => (
        <div key={f.id} className="flex items-center justify-between text-sm">
          <span>
            {f.label} · {formatNaira(f.amountKobo)} {BASIS[f.basis]}
            {f.includedGuests !== null && ` (after ${f.includedGuests} guests)`} {f.refundable && <Badge tone="info">Refundable</Badge>}
          </span>
          {canWrite && (
            <Button
              variant="ghost"
              onClick={async () => {
                await api(`/v1/fees/${f.id}/archive`, { method: 'POST' });
                await mutate();
              }}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {canWrite && (
        <form
          className="grid gap-2 md:grid-cols-[160px_1fr_160px_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(undefined);
            const parsed = UnitFeeInput.safeParse(draft);
            if (!parsed.success) return setErr(parsed.error.issues[0]?.message);
            await api(`/v1/units/${unitId}/fees`, { method: 'POST', body: parsed.data });
            await mutate();
          }}
        >
          <Field label="Type">
            <Select
              value={draft.kind}
              onChange={(e) => {
                const kind = e.target.value as UnitFeeInput['kind'];
                setDraft({ ...draft, kind, ...presets[kind] } as UnitFeeInput);
              }}
            >
              <option value="caution_deposit">Caution deposit</option>
              <option value="cleaning">Cleaning</option>
              <option value="extra_guest">Extra guest</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Label">
            <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          </Field>
          <Field label="Amount">
            <MoneyInput value={draft.amountKobo} onChange={(k) => setDraft({ ...draft, amountKobo: k })} />
          </Field>
          <Button type="submit" className="self-end">
            Add fee
          </Button>
          {draft.kind === 'extra_guest' && (
            <Field label="Guests included in the rate">
              <Input
                type="number"
                min={0}
                value={draft.includedGuests ?? 0}
                onChange={(e) => setDraft({ ...draft, includedGuests: Number(e.target.value) })}
              />
            </Field>
          )}
          {draft.kind === 'other' && (
            <Field label="Charged">
              <Select value={draft.basis} onChange={(e) => setDraft({ ...draft, basis: e.target.value as UnitFeeInput['basis'] })}>
                <option value="per_stay">Per stay</option>
                <option value="per_night">Per night</option>
              </Select>
            </Field>
          )}
          {err && (
            <p role="alert" className="text-sm text-danger md:col-span-4">
              {err}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
