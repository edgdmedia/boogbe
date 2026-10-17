import { House } from 'lucide-react';
import type { ReactNode } from 'react';

/** Auth pages: a brand panel from lg (decorative), the form card centred on phones. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-surface-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div aria-hidden="true" className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-ink lg:flex">
        <span className="flex items-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-chip bg-brand text-brand-ink">
            <House size={20} />
          </span>
          <span className="text-xl font-bold tracking-[-0.02em]">Boogbe</span>
        </span>
        <div>
          <p className="text-[40px] font-bold leading-tight tracking-[-0.03em]">Your shortlets, at home.</p>
          <p className="mt-3 max-w-md text-sidebar-muted">Bookings, payments and calendars, under one roof.</p>
        </div>
        <p className="text-sm text-sidebar-muted">by EDGD Media</p>
      </div>
      <main className="mx-auto flex w-full max-w-md flex-col justify-center p-4 py-10">{children}</main>
    </div>
  );
}
