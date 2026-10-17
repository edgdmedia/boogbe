import type { ReactNode } from 'react';

/** The page's title row. One h1 per page; badges go in `meta`, buttons in `actions`. */
export function PageHeader({
  title,
  eyebrow,
  meta,
  back,
  actions,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  back?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-line pb-4">
      <div className="min-w-0 flex-1 basis-60">
        {back && <div className="mb-1 md:hidden">{back}</div>}
        {eyebrow && <p className="eyebrow text-ink-muted">{eyebrow}</p>}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="min-w-0 truncate text-[22px] font-bold tracking-[-0.02em] text-ink md:text-[26px]">{title}</h1>
          {meta}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
