import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CalendarDays, Settings, TriangleAlert, Users } from 'lucide-react';
import { AppShell } from './AppShell';

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
});
