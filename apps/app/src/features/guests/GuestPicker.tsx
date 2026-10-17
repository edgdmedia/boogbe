import { useEffect, useState } from 'react';
import type { Guest } from '@boogbe/shared';
import { Button, Input } from '@boogbe/ui';
import { GuestForm } from './GuestForm';
import { useGuests } from './hooks';

export function GuestPicker({ value, onChange }: { value: Guest | null; onChange: (g: Guest | null) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = useGuests(debounced);
  if (value)
    return (
      <div className="flex items-center justify-between gap-2 rounded-control border border-brand/30 bg-brand-soft px-3 py-2">
        <span>
          <span className="font-semibold text-brand">{value.fullName}</span> <span className="text-sm text-ink-muted">{value.phoneE164}</span>
        </span>
        <Button variant="ghost" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  if (creating)
    return (
      <GuestForm
        onSaved={(g) => {
          setCreating(false);
          onChange(g);
        }}
        onMatch={(g) => {
          setCreating(false);
          onChange(g);
        }}
      />
    );
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[13px] font-semibold" htmlFor="guest-q">
        Find guest
      </label>
      <Input id="guest-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or email" autoComplete="off" />
      {debounced && (
        <ul role="listbox" aria-label="Guests" className="max-h-60 overflow-y-auto rounded-control border border-line bg-surface shadow-raised">
          {data?.items.map((g) => (
            <li
              key={g.id}
              role="option"
              aria-selected={false}
              tabIndex={0}
              onClick={() => onChange(g)}
              onKeyDown={(e) => e.key === 'Enter' && onChange(g)}
              className="min-h-11 cursor-pointer px-3 py-2.5 hover:bg-surface-2"
            >
              {g.fullName} <span className="text-sm text-ink-muted">{g.phoneE164}</span>
            </li>
          ))}
          {data && data.items.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">No match</li>}
        </ul>
      )}
      <Button variant="secondary" onClick={() => setCreating(true)}>
        New guest
      </Button>
    </div>
  );
}
