import type { ReactNode } from 'react';

export function StatTile({ label, value, sub, children }: { label: string; value: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-panel border border-line bg-surface p-5 shadow-card">
      <p className="eyebrow text-ink-muted">{label}</p>
      <p className="num mt-2 text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink">{value}</p>
      {sub && <p className="mt-1 text-[13px] text-ink-muted">{sub}</p>}
      {children}
    </div>
  );
}
