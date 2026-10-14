import clsx from 'clsx';
import { forwardRef, type SelectHTMLAttributes } from 'react';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...rest },
  ref,
) {
  return (
    <select ref={ref} {...rest} className={clsx('min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-ink', className)} />
  );
});
