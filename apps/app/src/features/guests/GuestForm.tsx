import { useState } from 'react';
import { z } from 'zod';
import { Guest, GuestInput } from '@boogbe/shared';
import { Button, Field, Input } from '@boogbe/ui';
import { PhoneInput } from '../../components/PhoneInput';
import { api } from '../../lib/api';

export function GuestForm({
  initial,
  onSaved,
  onMatch,
}: {
  initial?: Guest;
  onSaved: (g: Guest) => void;
  onMatch?: (g: Guest) => void;
}) {
  const [v, setV] = useState({
    fullName: initial?.fullName ?? '',
    phoneE164: initial?.phoneE164 ?? (null as string | null),
    email: initial?.email ?? '',
    notes: initial?.notes ?? '',
  });
  const [match, setMatch] = useState<Guest | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const check = async () => {
    if (initial || (!v.phoneE164 && !v.email)) return;
    const qs = new URLSearchParams({ ...(v.phoneE164 && { phone: v.phoneE164 }), ...(v.email && { email: v.email }) });
    const r = await api(`/v1/guests/match?${qs}`, { schema: z.object({ items: z.array(Guest) }) });
    setMatch(r.items[0] ?? null);
  };
  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = GuestInput.safeParse({
          fullName: v.fullName,
          phoneE164: v.phoneE164 ?? '',
          email: v.email || null,
          notes: v.notes || null,
        });
        if (!parsed.success) return setErr(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
        setBusy(true);
        try {
          onSaved(
            await api(initial ? `/v1/guests/${initial.id}` : '/v1/guests', {
              method: initial ? 'PATCH' : 'POST',
              body: parsed.data,
              schema: Guest,
            }),
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Full name" error={err.fullName}>
        <Input value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} />
      </Field>
      <Field label="Phone (WhatsApp)" error={err.phoneE164 && 'Enter a valid phone number'}>
        <PhoneInput value={v.phoneE164} onChange={(p) => setV({ ...v, phoneE164: p })} onBlur={check} />
      </Field>
      <Field label="Email (optional)" error={err.email}>
        <Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} onBlur={check} />
      </Field>
      {match && onMatch && (
        <div role="status" className="rounded-lg border border-warning bg-warning/10 p-3 text-sm">
          This looks like {match.fullName} ({match.bookingCount} bookings).{' '}
          <button type="button" className="font-medium underline" onClick={() => onMatch(match)}>
            Use existing guest
          </button>
        </div>
      )}
      <Field label="Notes">
        <Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </Field>
      <Button type="submit" loading={busy}>
        {initial ? 'Save guest' : 'Add guest'}
      </Button>
    </form>
  );
}
