import { useState } from 'react';
import { BlockInput } from '@boogbe/shared';
import { Button, Field, Input, Select } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';

export function BlockForm({
  unitId,
  start,
  end,
  onSaved,
}: {
  unitId: string;
  start: string;
  end: string;
  onSaved: () => void;
}) {
  const [v, setV] = useState({ unitId, start, end, reason: 'maintenance' as const, note: '' });
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(undefined);
        const parsed = BlockInput.safeParse(v);
        if (!parsed.success) return setErr(parsed.error.issues[0]?.message);
        setBusy(true);
        try {
          await api('/v1/blocks', { method: 'POST', body: parsed.data });
          onSaved();
        } catch (x) {
          setErr(x instanceof ApiError && x.code === 'DATES_UNAVAILABLE' ? 'Those dates overlap another booking or block.' : (x as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="From">
          <Input type="date" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} />
        </Field>
        <Field label="Until (free again)">
          <Input type="date" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} />
        </Field>
      </div>
      <Field label="Reason">
        <Select value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value as never })}>
          <option value="maintenance">Maintenance</option>
          <option value="owner_stay">Owner stay</option>
          <option value="other">Other</option>
        </Select>
      </Field>
      <Field label="Note">
        <Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </Field>
      {err && (
        <p role="alert" className="text-sm text-danger">
          {err}
        </p>
      )}
      <Button type="submit" loading={busy}>
        Block dates
      </Button>
    </form>
  );
}
