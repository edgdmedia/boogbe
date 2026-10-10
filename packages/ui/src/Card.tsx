import clsx from 'clsx';
import type { HTMLAttributes } from 'react';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={clsx('rounded-[var(--radius-card)] border border-line bg-surface p-4', className)} />;
}
