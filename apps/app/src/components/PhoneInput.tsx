import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { useState, type InputHTMLAttributes } from 'react';
import { normalizePhone } from '@boogbe/shared';
import { Input } from '@boogbe/ui';

export function PhoneInput({
  value,
  onChange,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string | null;
  onChange: (e164: string | null, raw: string) => void;
}) {
  const [raw, setRaw] = useState(value ?? '');
  const e164 = normalizePhone(raw);
  return (
    <div>
      <Input
        {...rest}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          onChange(normalizePhone(e.target.value), e.target.value);
        }}
      />
      {e164 && <p className="mt-1 text-xs text-ink-muted">{parsePhoneNumberFromString(e164)!.formatInternational()}</p>}
    </div>
  );
}
