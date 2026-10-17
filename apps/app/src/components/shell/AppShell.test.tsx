import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookOpen, Building2, CalendarDays, Contact, Settings, TriangleAlert, Users, Wallet } from 'lucide-react';
import { AppShell, type NavItem } from './AppShell';

vi.mock('../../lib/use-me', () => ({
  useMe: () => ({
    me: {
      user: { id: 'u', name: 'Ada', email: 'a@x', isPlatformAdmin: false },
      activeOrg: { id: 'o', name: 'Tanuhomes', slug: 't', role: 'frontdesk', timezone: 'Africa/Lagos', currency: 'NGN' },
      memberships: [{ orgId: 'o', orgName: 'Tanuhomes', role: 'frontdesk' }],
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
];
const shell = (path = '/calendar') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell nav={NAV}>
        <p>content</p>
      </AppShell>
    </MemoryRouter>,
  );

afterEach(() => vi.restoreAllMocks());

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
});
