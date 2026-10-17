import clsx from 'clsx';
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Left out of the phone card layout. */
  hideOnMobile?: boolean;
}

export function Table<T extends { id: string }>({
  columns,
  rows,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (r: T) => void;
}) {
  return (
    <div className="md:overflow-x-auto md:rounded-card md:border md:border-line md:bg-surface md:shadow-card">
      <table className="w-full text-left text-sm max-md:block">
        <thead className="border-b border-line max-md:sr-only">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={clsx('eyebrow px-4 py-3 text-ink-muted', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        {/* Below md each row is a card: same <tr>/<td> DOM, labels from data-label (no duplicated text). */}
        <tbody className="max-md:flex max-md:flex-col max-md:gap-3">
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={onRowClick && (() => onRowClick(r))}
              className={clsx(
                'border-t border-line first:border-t-0 max-md:block max-md:rounded-panel max-md:border max-md:bg-surface max-md:p-4 max-md:shadow-card',
                onRowClick && 'cursor-pointer hover:bg-surface-2',
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  data-label={c.header}
                  className={clsx(
                    'px-4 py-3 max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-3 max-md:px-0 max-md:py-1 max-md:text-right max-md:before:eyebrow max-md:before:shrink-0 max-md:before:text-left max-md:before:text-ink-muted max-md:before:content-[attr(data-label)]',
                    c.hideOnMobile && 'max-md:hidden',
                    c.className,
                  )}
                >
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
