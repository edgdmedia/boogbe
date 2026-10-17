import clsx from 'clsx';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useMe } from '../../lib/use-me';
import { visibleNav, type NavItem } from './AppShell';

/** Settings pages share one sub-navigation: a side list from md, scrolling chips on phones. */
export function SettingsLayout({ nav, children }: { nav: NavItem[]; children: ReactNode }) {
  const { me } = useMe();
  const items = visibleNav(nav, me?.activeOrg?.role).filter((n) => n.section === 'settings');
  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-6">
      <nav
        aria-label="Settings"
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:sticky md:top-4 md:mx-0 md:w-[216px] md:shrink-0 md:flex-col md:gap-1 md:overflow-visible md:rounded-panel md:border md:border-line md:bg-surface md:p-2 md:shadow-card"
      >
        <p aria-hidden="true" className="eyebrow hidden px-3 pb-1 pt-2 text-ink-muted md:block">
          Settings
        </p>
        {items.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              clsx(
                'flex min-h-11 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full border px-4 text-[13.5px] font-semibold md:rounded-control md:border-0 md:px-3',
                isActive
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-line bg-surface text-ink-muted hover:text-ink md:bg-transparent md:hover:bg-surface-2',
              )
            }
          >
            <n.icon size={17} aria-hidden className="hidden md:block" />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
