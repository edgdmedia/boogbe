import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { Input } from '@boogbe/ui';

// Kobo in, naira-decorated text out: whole naira show no decimals, any kobo shows both digits.
const toText = (kobo: number) =>
  kobo
    ? new Intl.NumberFormat('en-NG', {
        minimumFractionDigits: kobo % 100 ? 2 : 0,
        maximumFractionDigits: 2,
      }).format(kobo / 100)
    : '';
const parse = (s: string) => {
  const clean = s.replace(/[^\d.]/g, '');
  const [n = '', d = ''] = clean.split('.');
  return Number(n || 0) * 100 + Number((d + '00').slice(0, 2));
};

type Base = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>;

export function MoneyInput({ value, onChange, ...rest }: Base & { value: number; onChange: (kobo: number) => void }) {
  const [text, setText] = useState(toText(value));
  useEffect(() => {
    if (parse(text) !== value) setText(toText(value));
  }, [value]);
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-muted">
        ₦
      </span>
      <Input
        {...rest}
        inputMode="decimal"
        className={`num pl-8 ${rest.className ?? ''}`}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.,]/g, '');
          setText(t);
          onChange(parse(t));
        }}
        onBlur={(e) => {
          setText(toText(parse(text)));
          rest.onBlur?.(e);
        }}
      />
    </div>
  );
}

export function PercentInput({
  valueBps,
  onChange,
  ...rest
}: Base & { valueBps: number; onChange: (bps: number) => void }) {
  const [text, setText] = useState(valueBps ? String(valueBps / 100) : '');
  return (
    <div className="relative">
      <Input
        {...rest}
        inputMode="decimal"
        className={`pr-8 ${rest.className ?? ''}`}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.]/g, '');
          setText(t);
          onChange(Math.min(10_000, Math.round(Number(t || 0) * 100)));
        }}
      />
      <span aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-muted">
        %
      </span>
    </div>
  );
}

export const feeSummary = (f: { feeType: string; feeBps: number; feeFixedMonthlyKobo: number }, money: (k: number) => string) => {
  const pct = `${f.feeBps / 100}%`;
  const base = f.feeType === 'pct_gross' ? `${pct} of gross` : f.feeType === 'pct_net' ? `${pct} of net` : 'No commission';
  return f.feeFixedMonthlyKobo ? `${base} + ${money(f.feeFixedMonthlyKobo)}/month` : base;
};
