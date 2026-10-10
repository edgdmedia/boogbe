import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { can, type Permission } from '@boogbe/shared';
import { authClient } from '../../lib/auth-client';
import { useMe } from '../../lib/use-me';
import { OrgSwitcher } from './OrgSwitcher';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
}

export function AppShell({ nav, children }: { nav: NavItem[]; children: ReactNode }) {
  const { me } = useMe();
  const role = me?.activeOrg?.role;
  const items = nav.filter((n) => !n.permission || (role && can(role, n.permission)));
  const link = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm',
      isActive ? 'bg-brand/10 text-brand' : 'text-ink hover:bg-surface-2',
    );
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_1fr]">
      <aside className="hidden border-r border-line bg-surface p-3 md:flex md:flex-col md:gap-1">
        <div className="mb-4 px-2">
          <OrgSwitcher />
        </div>
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} className={link}>
            <n.icon size={18} aria-hidden />
            {n.label}
          </NavLink>
        ))}
        <button
          className="mt-auto flex min-h-11 items-center gap-2 px-3 text-sm text-ink-muted"
          onClick={async () => {
            await authClient.signOut();
            window.location.assign('/auth/sign-in');
          }}
        >
          <LogOut size={18} aria-hidden />
          Sign out
        </button>
      </aside>
      <header className="flex items-center justify-between border-b border-line bg-surface p-3 md:hidden">
        <OrgSwitcher />
      </header>
      <main className="p-4 pb-24 md:p-6">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 flex justify-around border-t border-line bg-surface md:hidden" aria-label="Main">
        {items.slice(0, 5).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              clsx(
                'flex min-h-14 flex-1 flex-col items-center justify-center text-xs',
                isActive ? 'text-brand' : 'text-ink-muted',
              )
            }
          >
            <n.icon size={20} aria-hidden />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
