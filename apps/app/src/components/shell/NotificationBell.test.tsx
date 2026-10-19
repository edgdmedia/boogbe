import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { NotificationBell } from './NotificationBell';

vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  api: vi.fn(async () => ({
    unreadCount: 2,
    items: [
      {
        id: 'n1',
        kind: 'hold_expired',
        title: 'Hold expired: TAN-2610-0001',
        body: null,
        link: '/bookings/b1',
        readAt: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'n2',
        kind: 'website_request',
        title: 'New booking request: TAN-2610-0002',
        body: 'Kairo · 20 Nov → 22 Nov',
        link: '/bookings/b2',
        readAt: null,
        createdAt: new Date().toISOString(),
      },
    ],
  })),
}));

describe('NotificationBell', () => {
  it('shows unread count and items', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MemoryRouter>
          <NotificationBell />
        </MemoryRouter>
      </SWRConfig>,
    );
    expect(await screen.findByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByRole('link', { name: /Hold expired: TAN-2610-0001/ })).toHaveAttribute('href', '/bookings/b1');
    const web = screen.getByRole('link', { name: /New booking request: TAN-2610-0002/ });
    expect(web.querySelector('[data-kind-icon="website_request"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: /Hold expired/ }).querySelector('[data-kind-icon]')).toBeNull();
  });
});
