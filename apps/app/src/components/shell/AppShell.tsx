import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { House, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings as SettingsIcon, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { can, OrgSettingsResponse, ROLE_LABELS, type OrgRole, type Permission } from '@boogbe/shared';
import { authClient } from '../../lib/auth-client';
import { useMe } from '../../lib/use-me';
import { useApi } from '../../lib/api';
import { NotificationBell } from './NotificationBell';
import { useConflicts } from '../../features/ical/hooks';
import { OrgSwitcher } from './OrgSwitcher';
import { readCollapsed, writeCollapsed } from './sidebar-pref';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  /** 'settings' items live in the settings side nav; the sidebar shows one "Settings" entry for them. */
  section?: 'main' | 'settings';
  /** Shown in the phone bottom bar. */
  tab?: boolean;
  end?: boolean;
}

export function visibleNav(nav: NavItem[], role: OrgRole | undefined): NavItem[] {
  return nav.filter((n) => !n.permission || (role && can(role, n.permission)));
}

/**
 * How the sidebar body lays out:
 *   rail — icons only (collapsed desktop);
 *   auto — rail at md–xl, full from xl (the aside's default);
 *   full — labels everywhere (the phone drawer).
 * One body per container, so jsdom (no CSS) never sees duplicate links. Tailwind needs the literal
 * class strings, so each mode's classes are spelled out here rather than built with string prefixes.
 */
type Mode = 'rail' | 'auto' | 'full';
const LABEL: Record<Mode, string> = { rail: 'sr-only', auto: 'sr-only xl:not-sr-only xl:truncate', full: 'truncate' };
const ONLY_FULL: Record<Mode, string> = { rail: 'hidden', auto: 'hidden xl:flex', full: 'flex' };
const ROW: Record<Mode, string> = { rail: 'justify-center', auto: 'justify-center xl:justify-start xl:px-3', full: 'px-3' };
const BAR: Record<Mode, string> = { rail: 'hidden', auto: 'hidden xl:block', full: 'block' };
const COUNT: Record<Mode, string> = { rail: 'absolute right-1 top-1', auto: 'absolute right-1 top-1 xl:static xl:ml-auto', full: 'ml-auto' };

// No px-* here: ROW sets it, and Tailwind resolves conflicting utilities by stylesheet order, not class order.
const ITEM = 'relative flex min-h-11 items-center gap-2.5 rounded-control text-[13.5px] font-semibold transition-colors';
const IDLE = 'text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-ink';
const ACTIVE =
  'bg-[linear-gradient(90deg,var(--color-brand-600),color-mix(in_oklab,var(--color-brand-500)_60%,transparent))] text-white shadow-[inset_0_0_0_1px_rgb(63_181_155/.3)]';

function SideLink({ item, active, mode, badge }: { item: NavItem; active?: boolean; mode: Mode; badge?: number }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={mode === 'full' ? undefined : item.label}
      aria-current={active ? 'page' : undefined}
      className={({ isActive }) => clsx(ITEM, ROW[mode], (active ?? isActive) ? ACTIVE : IDLE)}
    >
      {({ isActive }) => (
        <>
          {(active ?? isActive) && (
            <span aria-hidden="true" className={clsx('absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-brand-400', BAR[mode])} />
          )}
          <item.icon size={18} aria-hidden className="shrink-0" />
          <span className={LABEL[mode]}>{item.label}</span>
          {!!badge && <span className={clsx('rounded-full bg-danger px-1.5 text-[10px] font-bold text-danger-ink', COUNT[mode])}>{badge}</span>}
        </>
      )}
    </NavLink>
  );
}

export function AppShell({ nav, children }: { nav: NavItem[]; children: ReactNode }) {
  const { me } = useMe();
  const role = me?.activeOrg?.role;
  const items = visibleNav(nav, role);
  const main = items.filter((n) => (n.section ?? 'main') === 'main');
  const settingsItems = items.filter((n) => n.section === 'settings');
  const tabs = main.filter((n) => n.tab);
  const { pathname } = useLocation();
  const inSettings = pathname === '/settings' || pathname.startsWith('/settings/');
  // Logo only where the viewer can read org settings; the API already refuses everyone else.
  const { data: orgSettings } = useApi(role && can(role, 'org.settings.read') ? '/v1/org/settings' : null, OrgSettingsResponse);
  const logo = orgSettings?.settings.logoUrl;
  // same SWR key as the conflicts page — one request serves both. Only fetched when the
  // member can read bookings (platform-only admins have no org context to ask about).
  const canSeeConflicts = !!role && can(role, 'bookings.read');
  const { data: conflicts } = useConflicts(canSeeConflicts ? 'open' : null);
  const openConflicts = canSeeConflicts ? (conflicts?.items.length ?? 0) : 0;
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);

  const signOut = async () => {
    await authClient.signOut();
    window.location.assign('/auth/sign-in');
  };

  const body = (mode: Mode) => (
    <>
      <div className={clsx('flex items-center gap-2.5', ROW[mode])}>
        <span className="grid size-9 shrink-0 place-items-center rounded-chip bg-brand text-brand-ink">
          <House size={18} aria-hidden />
        </span>
        <span className={clsx(LABEL[mode], 'text-[17px] font-bold tracking-[-0.02em] text-sidebar-ink')}>Boogbe</span>
      </div>
      <div className={clsx('min-w-0 items-center gap-2 rounded-panel bg-white/[0.045] p-2', ONLY_FULL[mode])}>
        {logo && <img src={logo} alt="" className="size-8 shrink-0 rounded-chip bg-white object-contain" />}
        <OrgSwitcher tone="dark" />
      </div>
      <nav aria-label="Sidebar" className="no-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {main.length > 0 && <p className={clsx(LABEL[mode], 'eyebrow px-3 pb-1 pt-2 text-sidebar-muted')}>Operations</p>}
        {main.map((n) => (
          <SideLink key={n.to} item={n} mode={mode} badge={n.to === '/conflicts' ? openConflicts : undefined} />
        ))}
        {settingsItems.length > 0 && (
          <>
            <p className={clsx(LABEL[mode], 'eyebrow px-3 pb-1 pt-5 text-sidebar-muted')}>Setup</p>
            <SideLink item={{ ...settingsItems[0]!, label: 'Settings', icon: SettingsIcon, end: false }} active={inSettings} mode={mode} />
          </>
        )}
      </nav>
      <div className="flex flex-col gap-1 border-t border-white/[0.07] pt-3">
        {me && (
          <p className={clsx('flex-col px-3 text-[13px] text-sidebar-ink', ONLY_FULL[mode])}>
            <span className="truncate">{me.user.name}</span>
            {role && <span className="text-xs text-sidebar-muted">{ROLE_LABELS[role]}</span>}
          </p>
        )}
        <button onClick={signOut} title={mode === 'full' ? undefined : 'Sign out'} className={clsx(ITEM, IDLE, ROW[mode])}>
          <LogOut size={18} aria-hidden />
          <span className={LABEL[mode]}>Sign out</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-dvh bg-surface-2 md:flex">
      {/* md–xl rail, full from xl unless collapsed — CSS only, no matchMedia, one body. */}
      <aside
        className={clsx(
          'sticky top-0 hidden h-dvh shrink-0 flex-col gap-5 border-r border-white/5 bg-sidebar px-2.5 py-5 md:flex',
          collapsed ? 'w-[76px]' : 'w-[76px] xl:w-[248px] xl:px-3.5',
        )}
      >
        {body(collapsed ? 'rail' : 'auto')}
        <button
          onClick={() => {
            setCollapsed(!collapsed);
            writeCollapsed(!collapsed);
          }}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={clsx(
            'hidden min-h-9 items-center gap-2 rounded-control text-[12.5px] font-semibold text-sidebar-muted hover:bg-sidebar-hover xl:flex',
            collapsed ? 'justify-center' : 'px-3',
          )}
        >
          {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
          {!collapsed && <span aria-hidden="true">Collapse</span>}
        </button>
      </aside>
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          {logo ? (
            <img src={logo} alt="" className="size-8 shrink-0 rounded-chip border border-line object-contain" />
          ) : (
            <span className="grid size-8 shrink-0 place-items-center rounded-chip bg-brand text-brand-ink">
              <House size={16} aria-hidden />
            </span>
          )}
          <OrgSwitcher />
        </div>
        {/* Conflicts is not a tab — keep open conflicts one tap away on a phone. */}
        <span className="flex items-center gap-2">
          {canSeeConflicts && openConflicts > 0 && (
            <NavLink to="/conflicts" className="flex min-h-11 items-center gap-1 rounded-full px-2 text-xs font-semibold text-ink-muted">
              <TriangleAlert size={16} aria-hidden />
              Conflicts
              <span className="rounded-full bg-danger px-1.5 text-[10px] font-bold text-danger-ink">{openConflicts}</span>
            </NavLink>
          )}
          <NotificationBell />
        </span>
      </header>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="hidden justify-end px-6 pt-3 md:flex xl:px-[26px]">
          <NotificationBell />
        </div>
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-28 pt-4 md:px-6 md:pb-8 md:pt-2 xl:px-[26px]">{children}</main>
      </div>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex h-[68px] items-stretch border-t border-line bg-surface/90 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        {tabs.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              clsx('flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold', isActive ? 'text-brand' : 'text-ink-muted')
            }
          >
            <n.icon size={20} aria-hidden />
            <span className="truncate">{n.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setMenuOpen(true)}
          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold text-ink-muted"
        >
          <Menu size={20} aria-hidden />
          More
        </button>
      </nav>
      <MenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)}>
        {body('full')}
      </MenuDrawer>
    </div>
  );
}

function MenuDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label="Menu"
      className="m-0 h-dvh max-h-none w-[min(300px,85vw)] bg-sidebar p-0 text-sidebar-ink backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      {open && (
        <div className="flex h-full flex-col gap-5 px-3.5 py-5">
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="ml-auto grid min-h-11 min-w-11 place-items-center rounded-control text-sidebar-muted hover:bg-sidebar-hover"
          >
            <X size={20} aria-hidden />
          </button>
          {children}
        </div>
      )}
    </dialog>
  );
}
