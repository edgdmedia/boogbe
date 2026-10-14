import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { ConflictsPage } from './ConflictsPage';

const items = {
  items: [
    {
      id: 'c1',
      status: 'open',
      resolution: null,
      unit: { id: 'u1', name: 'Kairo' },
      booking: { id: 'b1', ref: 'TAN-2610-0003', guestName: 'Ada', checkIn: '2026-11-01', checkOut: '2026-11-04', status: 'confirmed' },
      block: { id: 'k1', start: '2026-11-03', end: '2026-11-05', summary: 'Reserved', channel: 'airbnb' },
      createdAt: '2026-10-10T00:00:00Z',
      resolvedAt: null,
    },
  ],
};

vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  api: vi.fn(async () => items),
  useApi: () => ({ data: items, mutate: vi.fn() }),
}));
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { role: 'admin', timezone: 'Africa/Lagos' } } }) }));

describe('ConflictsPage', () => {
  it('explains the overlap and offers the three actions', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MemoryRouter>
          <ConflictsPage />
        </MemoryRouter>
      </SWRConfig>,
    );
    expect(await screen.findByText(/Airbnb shows 3 Nov 2026 – 5 Nov 2026 as taken/)).toBeInTheDocument();
    for (const name of ["It's handled on Airbnb", 'Cancel Boogbe booking', 'I moved the booking'])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });
});
