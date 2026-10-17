import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookOpen, Building2, CalendarDays, Contact, Settings, TriangleAlert, Users, Wallet } from 'lucide-react';
import { AppShell, type NavItem } from './AppShell';

const who = vi.hoisted(() => ({ role: 'frontdesk', memberships: 1 }));
vi.mock('../../lib/use-me', () => ({
  useMe: () => ({
    me: {
      user: { id: 'u', name: 'Ada', email: 'a@x', isPlatformAdmin: false },
      activeOrg: { id: 'o', name: 'Tanuhomes', slug: 't', role: who.role, timezone: 'Africa/Lagos', currency: 'NGN' },
      memberships: [
        { orgId: 'o', orgName: 'Tanuhomes', role: who.role },
        ...(who.memberships > 1 ? [{ orgId: 'o2', orgName: 'Lumina Stays', role: 'admin' }] : []),
      ],
    },
  }),
}));
vi.mock('../../lib/auth-client', () => ({ authClient: { organization: { setActive: vi.fn() }, signOut: vi.fn() } }));
vi.mock('../../features/ical/hooks', () => ({ useConflicts: () => ({ data: { items: [{ id: 'c1' }, { id: 'c2' }] } }) }));

const NAV: NavItem[] = [
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, permission: 'calendar.read', tab: true },
  { to: '/bookings', label: 'Bookings', icon: BookOpen, permission: 'bookings.read', tab: true },
  { to: '/guests', label: 'Guests', icon: Contact, permission: 'guests.read', tab: true },
  { to: '/money', label: 'Money', icon: Wallet, permission: 'payments.read', tab: true },
  { to: '/conflicts', label: 'Conflicts', icon: TriangleAlert, permission: 'bookings.read' },
  { to: '/settings', label: 'Business', icon: Settings, permission: 'org.settings.read', section: 'settings', end: true },
  { to: '/settings/properties', label: 'Properties', icon: Building2, permission: 'inventory.read', section: 'settings' },
  { to: '/settings/team', label: 'Team', icon: Users, permission: 'members.write', section: 'settings' },
  { to: '/settings/sessions', label: 'Signed-in devices', icon: Users, section: 'settings' },
];
const shell = (path = '/calendar') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell nav={NAV}>
        <p>content</p>
      </AppShell>
    </MemoryRouter>,
  );

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear(); // the collapse test writes '1'; later tests must start expanded
  who.role = 'frontdesk';
  who.memberships = 1;
});

describe('AppShell', () => {
  it('hides nav items the role cannot use', () => {
    render(
      <MemoryRouter>
        <AppShell
          nav={[
            { to: '/calendar', label: 'Calendar', icon: CalendarDays, permission: 'calendar.read' },
            { to: '/settings/team', label: 'Team', icon: Users, permission: 'members.write' },
            { to: '/settings', label: 'Settings', icon: Settings, permission: 'org.settings.write' },
          ]}
        >
          <p>content</p>
        </AppShell>
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('link', { name: /calendar/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /team/i })).toBeNull();
    expect(screen.getAllByText('Tanuhomes').length).toBeGreaterThan(0);
  });

  it('surfaces open conflicts in the mobile header, not just the sidebar', () => {
    render(
      <MemoryRouter>
        <AppShell
          nav={[
            { to: '/calendar', label: 'Calendar', icon: CalendarDays, permission: 'calendar.read' },
            { to: '/conflicts', label: 'Conflicts', icon: TriangleAlert, permission: 'bookings.read' },
          ]}
        >
          <p>content</p>
        </AppShell>
      </MemoryRouter>,
    );
    // The bottom tab bar shows only the first five items; Conflicts sits below the fold on a phone,
    // so the header carries an always-visible chip when count > 0 (md:hidden header = the banner role).
    const header = screen.getByRole('banner');
    const chip = within(header).getByRole('link', { name: /conflicts/i });
    expect(chip).toHaveAttribute('href', '/conflicts');
    expect(chip).toHaveTextContent('2');
    expect(within(screen.getByRole('complementary')).getByText('2')).toBeInTheDocument();
  });

  it('bottom bar shows the four tabs and More, nothing else', () => {
    shell();
    const bar = screen.getByRole('navigation', { name: 'Main' });
    expect(within(bar).getAllByRole('link').map((a) => a.textContent)).toEqual(['Calendar', 'Bookings', 'Guests', 'Money']);
    expect(within(bar).getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('settings pages collapse into one Settings entry that opens the first page the role can see', () => {
    shell('/settings/properties');
    const side = screen.getByRole('complementary');
    const settings = within(side).getByRole('link', { name: 'Settings' });
    expect(settings).toHaveAttribute('href', '/settings');
    expect(settings).toHaveAttribute('aria-current', 'page'); // active on any /settings/* path
    expect(within(side).queryByRole('link', { name: 'Team' })).toBeNull();
    expect(within(side).queryByRole('link', { name: 'Properties' })).toBeNull();
  });

  it('More opens the menu drawer with every destination', () => {
    shell();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('dialog', { name: 'Menu' });
    expect(within(menu).getByRole('link', { name: /Conflicts/ })).toHaveAttribute('href', '/conflicts');
    expect(within(menu).getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('menu drawer backdrop stays dark in dark mode', () => {
    shell();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const cls = screen.getByRole('dialog', { name: 'Menu' }).className;
    expect(cls).toContain('backdrop:bg-black/50');
    expect(cls).not.toContain('backdrop:bg-ink');
  });

  it('remembers a collapsed sidebar', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    shell();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(set).toHaveBeenCalledWith('boogbe:sidebar-collapsed', '1');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('renders expanded when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    shell();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });

  // Review fixes (#91)
  it("Settings opens the first settings page the role can see, even when Business is hidden", () => {
    who.role = 'housekeeper'; // no org.settings.read / inventory.read — only Signed-in devices
    shell('/settings/sessions');
    const settings = within(screen.getByRole('complementary')).getByRole('link', { name: 'Settings' });
    expect(settings).toHaveAttribute('href', '/settings/sessions');
    expect(within(screen.getByRole('complementary')).queryByRole('link', { name: 'Calendar' })).toBeNull();
  });

  it('the sidebar operator switcher does not inherit the light field colours (unreadable on the dark sidebar)', () => {
    who.memberships = 2;
    shell();
    const side = within(screen.getByRole('complementary')).getByRole('combobox', { name: 'Operator' });
    expect(side.className).not.toMatch(/(^|\s)(bg-surface-2|focus:bg-surface|text-ink)(\s|$)/);
    expect(side.className).toContain('bg-sidebar-hover');
  });

  it('the operator stays visible and switchable when the sidebar is a rail (md–xl or collapsed)', () => {
    who.memberships = 2;
    localStorage.setItem('boogbe:sidebar-collapsed', '1');
    shell();
    const strip = screen.getByTestId('top-strip');
    expect(within(strip).getByRole('combobox', { name: 'Operator' })).toBeInTheDocument();
  });

  it('section labels keep their padding when they turn visible at xl', () => {
    shell();
    const label = within(screen.getByRole('complementary')).getByText('Operations');
    // the element toggling sr-only must not carry the padding: not-sr-only resets padding to 0
    if (label.className.includes('not-sr-only')) expect(label.className).not.toMatch(/(^|\s)(px|pt|pb)-/);
  });
});
