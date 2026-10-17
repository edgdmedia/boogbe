import clsx from 'clsx';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { FIELD, width } from './field-classes';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} {...rest} className={clsx('min-h-11', width(className), FIELD, className)} />;
});
