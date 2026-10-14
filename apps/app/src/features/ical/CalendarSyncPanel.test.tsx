import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { CalendarSyncPanel } from './CalendarSyncPanel';

const payload = {
  feeds: [
    {
      id: 'f1',
      unitId: 'u1',
      label: 'Airbnb',
      channel: 'airbnb',
      urlHost: 'www.airbnb.com',
      lastSyncedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      lastAttemptAt: null,
      lastStatus: 'error',
      lastError: 'Calendar link not found (404)',
      consecutiveFailures: 3,
      active: true,
      blockCount: 2,
    },
  ],
  exports: [
    {
      id: 'e1',
      unitId: 'u1',
      channel: 'airbnb',
      url: 'https://api.boogbe.com/v1/ical/tok.ics',
      excludeFeedId: 'f1',
      createdAt: '2026-10-10T00:00:00Z',
      rotatedAt: null,
    },
  ],
};

vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  api: vi.fn(async () => ({})),
  useApi: () => ({ data: payload, mutate: vi.fn() }),
}));

describe('CalendarSyncPanel', () => {
  it('shows failing feeds and copies export links', async () => {
    const write = vi.fn();
    Object.assign(navigator, { clipboard: { writeText: write } });
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <CalendarSyncPanel unitId="u1" canWrite />
      </SWRConfig>,
    );
    expect(await screen.findByText(/Failing: Calendar link not found \(404\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy Airbnb link' }));
    expect(write).toHaveBeenCalledWith('https://api.boogbe.com/v1/ical/tok.ics');
  });
});
