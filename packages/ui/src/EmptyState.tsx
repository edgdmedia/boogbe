import type { ReactNode } from 'react';

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line-strong bg-surface p-10 text-center">
      {icon && <div className="mb-1 grid size-12 place-items-center rounded-panel bg-brand-soft text-brand [&_svg]:size-6">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {body && <p className="max-w-sm text-sm text-ink-muted">{body}</p>}
      {action}
    </div>
  );
}
