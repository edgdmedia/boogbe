import clsx from 'clsx';
import type { ReactNode } from 'react';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const tones: Record<Tone, string> = {
  neutral: 'border-line bg-surface-2 text-ink-muted',
  success: 'border-success/25 bg-success/10 text-success',
  warning: 'border-warning/25 bg-warning/8 text-warning', // /10 gives 4.46:1 on white; /8 gives 4.58
  danger: 'border-danger/25 bg-danger/10 text-danger',
  info: 'border-info/25 bg-info/10 text-info',
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
