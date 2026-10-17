import clsx from 'clsx';
import type { ButtonHTMLAttributes } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';
const styles: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink shadow-button hover:brightness-110',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
  danger: 'bg-danger text-danger-ink hover:brightness-110',
  ghost: 'text-ink-muted hover:bg-surface-2 hover:text-ink',
};
// md is the 44px touch target; sm (36px) is only for dense desktop rows.
const sizes: Record<Size, string> = { sm: 'min-h-9 px-3 text-[13px]', md: 'min-h-11 px-4 text-sm' };

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-[filter,background-color,color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50',
        sizes[size],
        styles[variant],
        className,
      )}
    >
      {loading && <Spinner size={16} />}
      {children}
    </button>
  );
}
