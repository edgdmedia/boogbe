import { useState } from 'react';
import { Field, Input } from '@boogbe/ui';

// Editable chips for amenities and house rules: type, Enter or comma adds, × removes.
export function ChipListInput({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim().replace(/,+$/, '');
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft('');
  };
  return (
    <Field label={label} hint="Type and press Enter to add.">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((v) => (
          <span key={v} className="inline-flex h-7 items-center gap-1 rounded-chip border border-line bg-surface-2 px-2 text-[13px] font-medium text-ink">
            {v}
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${v}`}
                className="grid size-4 place-items-center rounded-full text-ink-muted hover:bg-surface hover:text-danger"
                onClick={() => onChange(value.filter((x) => x !== v))}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <Input
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          className="h-8 min-w-36 flex-1"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            } else if (e.key === 'Backspace' && !draft && value.length && !disabled) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={add}
        />
      </div>
    </Field>
  );
}
