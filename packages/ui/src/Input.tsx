import clsx from 'clsx';
import { forwardRef, type InputHTMLAttributes } from 'react';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      {...rest}
      className={clsx(
        'min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-brand aria-[invalid=true]:border-danger',
        className,
      )}
    />
  );
});
