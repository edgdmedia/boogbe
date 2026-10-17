import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { OPERATOR_NAV } from '../../nav';
import { SettingsLayout } from './SettingsLayout';

vi.mock('../../lib/use-me', () => ({
  useMe: () => ({ me: { user: { id: 'u', name: 'Ada' }, activeOrg: { id: 'o', name: 'Tanuhomes', role: 'frontdesk' }, memberships: [] } }),
}));

describe('SettingsLayout', () => {
  it('lists only the settings pages the role can open, with the current one marked', () => {
    render(
      <MemoryRouter initialEntries={['/settings/properties']}>
        <SettingsLayout nav={OPERATOR_NAV}>
          <p>page</p>
        </SettingsLayout>
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Business', 'Properties', 'Signed-in devices']);
    expect(within(nav).getByRole('link', { name: 'Properties' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Business' })).not.toHaveAttribute('aria-current');
  });
});
