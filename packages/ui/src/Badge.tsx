import clsx from 'clsx';
import type { ReactNode } from 'react';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
// Tints are mixed with surface (opaque), not translucent: a translucent tint's contrast depends on what is
// behind it — warning text fell to ~4.2:1 on the grey page header. Opaque, warning/8 is 4.58:1 everywhere.
const tones: Record<Tone, string> = {
  neutral: 'border-line bg-surface-2 text-ink-muted',
  success: 'border-success/25 bg-[color-mix(in_srgb,var(--color-success)_10%,var(--color-surface))] text-success',
  warning: 'border-warning/25 bg-[color-mix(in_srgb,var(--color-warning)_8%,var(--color-surface))] text-warning',
  danger: 'border-danger/25 bg-[color-mix(in_srgb,var(--color-danger)_10%,var(--color-surface))] text-danger',
  info: 'border-info/25 bg-[color-mix(in_srgb,var(--color-info)_10%,var(--color-surface))] text-info',
};

/** The text is the signal; the dot is decoration, so colour is never the only cue. */
export function Badge({ tone = 'neutral', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  const showDot = dot ?? tone !== 'neutral';
  return (
    <span
      className={clsx(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold',
        tones[tone],
      )}
    >
      {showDot && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}
