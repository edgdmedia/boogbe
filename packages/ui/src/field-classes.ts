/** Shared look of Input, Select and Textarea (not exported from the package). */
export const FIELD =
  'rounded-control border border-line-strong bg-surface-2 px-3.5 text-ink placeholder:text-ink-muted transition-colors focus:border-brand focus:bg-surface focus:outline-hidden focus:ring-3 focus:ring-brand/25 disabled:opacity-60 aria-[invalid=true]:border-danger';

/**
 * Full width unless the caller sets its own base width (`w-40`). Tailwind orders conflicting utilities by
 * stylesheet position, not class order, so `w-full` would otherwise beat `w-40`. Responsive widths
 * (`md:w-64`) still win over the default, being variants.
 */
export const width = (className?: string) => (/(^|\s)w-/.test(className ?? '') ? undefined : 'w-full');
