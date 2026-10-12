import { useState } from 'react';
import { SetPropertyOwnerInput, todayIn } from '@boogbe/shared';
import { Button, Field, Input, Select } from '@boogbe/ui';
import { api } from '../../lib/api';
import { useMe } from '../../lib/use-me';
import { useOwners } from './hooks';

export function PropertyOwnerForm({
  propertyId,
  currentName,
  onSaved,
}: {
  propertyId: string;
  currentName: string | null;
  onSaved: () => void;
}) {
  const { me } = useMe();
  const { data } = useOwners();
  const [ownerId, setOwnerId] = useState('__operator__');
  const [from, setFrom] = useState(todayIn(me?.activeOrg?.timezone ?? 'Africa/Lagos'));
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(undefined);
        const parsed = SetPropertyOwnerInput.safeParse({ defaultOwnerId: ownerId === '__operator__' ? null : ownerId, effectiveFrom: from });
        if (!parsed.success) return setErr(parsed.error.issues[0]?.message ?? 'Check the values');
        setBusy(true);
        try {
          await api(`/v1/properties/${propertyId}/owner`, { method: 'POST', body: parsed.data });
          onSaved();
        } catch (x) {
          setErr((x as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {currentName && <p className="text-sm text-ink-muted">Currently: {currentName}. Changing this moves every unit that follows the property, from the date below.</p>}
      <Field label="Default owner">
        <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="__operator__">Operator (self-owned)</option>
          {data?.items.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="From" hint="Units keep their own owner unless they follow the property">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
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
