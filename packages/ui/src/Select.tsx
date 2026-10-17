import clsx from 'clsx';
import { forwardRef, type SelectHTMLAttributes } from 'react';
import { FIELD, width } from './field-classes';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...rest },
  ref,
) {
  return <select ref={ref} {...rest} className={clsx('min-h-11', width(className), FIELD, className)} />;
});
