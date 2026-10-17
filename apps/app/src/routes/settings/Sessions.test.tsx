import { render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { Sessions } from './Sessions';

vi.mock('../../lib/auth-client', () => ({
  authClient: {
    listSessions: async () => ({
      data: [
        { id: 's1', userAgent: 'Chrome on Android', createdAt: '2026-10-17T08:00:00Z' },
        { id: 's2', userAgent: 'Safari on iPhone', createdAt: '2026-10-16T08:00:00Z' },
      ],
    }),
    revokeOtherSessions: vi.fn(),
  },
}));

describe('Sessions', () => {
  it('lists devices as divided rows, like the other settings lists', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <Sessions />
      </SWRConfig>,
    );
    const row = await screen.findByText(/Chrome on Android/);
    expect(row.className).toContain('border-t');
    expect(row.className).toContain('first:border-t-0');
    expect(screen.getByRole('button', { name: 'Sign out other devices' })).toBeInTheDocument();
  });
});
