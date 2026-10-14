import { useState } from 'react';
import { Channel, CHANNEL_LABELS, IcalFeedInput } from '@boogbe/shared';
import { Button, Field, Input, Select } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { IMPORT_HELP } from './channel-help';

export function AddFeedForm({ unitId, onSaved }: { unitId: string; onSaved: () => void }) {
  const [v, setV] = useState({ channel: 'airbnb' as Channel, label: 'Airbnb', url: '' });
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(undefined);
        const p = IcalFeedInput.safeParse({ unitId, ...v });
        if (!p.success) return setErr(p.error.issues[0]?.message);
        setBusy(true);
        try {
          await api('/v1/ical/feeds', { method: 'POST', body: p.data });
          onSaved();
        } catch (x) {
          setErr(x instanceof ApiError ? x.message : String(x));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Channel">
        <Select
          value={v.channel}
          onChange={(e) => {
            const c = e.target.value as Channel;
            setV({ ...v, channel: c, label: CHANNEL_LABELS[c] });
          }}
        >
          {Channel.options.map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABELS[c]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Name">
        <Input value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} />
      </Field>
      <Field label="Calendar link" hint={IMPORT_HELP[v.channel]} error={err}>
        <Input inputMode="url" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value.trim() })} placeholder="https://…" />
      </Field>
      <Button type="submit" loading={busy}>
        Connect
      </Button>
    </form>
  );
}
