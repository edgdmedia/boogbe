import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { LogOut, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { can, OrgSettingsResponse, type Permission } from '@boogbe/shared';
import { authClient } from '../../lib/auth-client';
import { useMe } from '../../lib/use-me';
import { useApi } from '../../lib/api';
import { NotificationBell } from './NotificationBell';
import { useConflicts } from '../../features/ical/hooks';
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
  // Logo only where the viewer can read org settings; the API already refuses everyone else.
  const { data: orgSettings } = useApi(role && can(role, 'org.settings.read') ? '/v1/org/settings' : null, OrgSettingsResponse);
  const logo = orgSettings?.settings.logoUrl;
  // same SWR key as the conflicts page — one request serves both. Only fetched when the
  // member can read bookings (platform-only admins have no org context to ask about).
  const canSeeConflicts = !!role && can(role, 'bookings.read');
  const { data: conflicts } = useConflicts(canSeeConflicts ? 'open' : null);
  const openConflicts = canSeeConflicts ? (conflicts?.items.length ?? 0) : 0;
  const link = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm',
      isActive ? 'bg-brand/10 text-brand' : 'text-ink hover:bg-surface-2',
    );
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_1fr]">
      <aside className="hidden border-r border-line bg-surface p-3 md:flex md:flex-col md:gap-1">
        <div className="mb-4 flex items-center justify-between gap-2 px-2">
          <span className="flex min-w-0 items-center gap-2">
            {logo && <img src={logo} alt="" className="h-8 w-8 shrink-0 rounded-md border border-line object-contain" />}
            <OrgSwitcher />
          </span>
          <NotificationBell />
        </div>
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} className={link}>
            <n.icon size={18} aria-hidden />
            {n.label}
            {n.to === '/conflicts' && openConflicts > 0 && (
              <span className="ml-auto rounded-full bg-danger px-1.5 text-[10px] font-semibold text-danger-ink">{openConflicts}</span>
            )}
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
      <header className="flex items-center justify-between gap-2 border-b border-line bg-surface p-3 md:hidden">
        <div className="flex items-center gap-2">
          {logo && <img src={logo} alt="" className="h-7 w-7 shrink-0 rounded-md border border-line object-contain" />}
          <OrgSwitcher />
        </div>
        {/* The tab bar holds five items and Conflicts sits below them on a phone — the header keeps
            open conflicts visible and one tap away whenever count > 0. */}
        <span className="flex items-center gap-2">
          {canSeeConflicts && openConflicts > 0 && (
            <NavLink to="/conflicts" className="flex items-center gap-1 text-xs text-ink-muted">
              <TriangleAlert size={16} aria-hidden />
              Conflicts
              <span className="rounded-full bg-danger px-1.5 text-[10px] font-semibold text-danger-ink">{openConflicts}</span>
            </NavLink>
          )}
          <NotificationBell />
        </span>
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
