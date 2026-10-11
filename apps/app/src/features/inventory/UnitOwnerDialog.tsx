import { useState } from 'react';
import { todayIn, type Unit } from '@boogbe/shared';
import { Button, Field, Input, Select } from '@boogbe/ui';
import { api } from '../../lib/api';
import { useMe } from '../../lib/use-me';
import { useOwners } from './hooks';

export function UnitOwnerForm({ unit, onSaved }: { unit: Unit; onSaved: () => void }) {
  const { me } = useMe();
  const { data } = useOwners();
  const [mode, setMode] = useState<'property' | 'owner' | 'operator'>(
    unit.ownerFollowsProperty ? 'property' : unit.currentOwner ? 'owner' : 'operator',
  );
  const [ownerId, setOwnerId] = useState(unit.currentOwner?.id ?? '');
  const [from, setFrom] = useState(todayIn(me?.activeOrg?.timezone ?? 'Africa/Lagos'));
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(undefined);
        try {
          await api(`/v1/units/${unit.id}/owner`, {
            method: 'POST',
            body: mode === 'owner' ? { mode, ownerId, effectiveFrom: from } : { mode, effectiveFrom: from },
          });
          onSaved();
        } catch (x) {
          setErr((x as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Who owns this unit?">
        <Select
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <option value="property">Same as the property</option>
          <option value="owner">A specific owner</option>
          <option value="operator">The operator (self-owned)</option>
        </Select>
      </Field>
      {mode === 'owner' && (
        <Field label="Owner">
          <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} required>
            <option value="">Choose…</option>
            {data?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="From" hint="Statements use the owner on each night">
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
