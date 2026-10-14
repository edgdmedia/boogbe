import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CalendarDays, Settings, Users } from 'lucide-react';
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
});
