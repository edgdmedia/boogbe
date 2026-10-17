import clsx from 'clsx';
import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { FIELD, width } from './field-classes';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} {...rest} className={clsx('min-h-24 py-2.5', width(className), FIELD, className)} />;
});
