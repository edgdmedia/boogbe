import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { CalendarSyncPanel } from './CalendarSyncPanel';
import { api } from '../../lib/api';

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
    const write = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText: write } });
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <CalendarSyncPanel unitId="u1" canWrite />
      </SWRConfig>,
    );
    expect(await screen.findByText(/Failing: Calendar link not found \(404\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy Airbnb link' }));
    expect(write).toHaveBeenCalledWith('https://api.boogbe.com/v1/ical/tok.ics');
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  it('says copy failed when the clipboard rejects (permissions, insecure context)', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => { throw new Error('NotAllowedError'); }) } });
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <CalendarSyncPanel unitId="u1" canWrite />
      </SWRConfig>,
    );
    await screen.findByText(/Failing: Calendar link not found \(404\)/);
    await userEvent.click(screen.getByRole('button', { name: 'Copy Airbnb link' }));
    expect(await screen.findByText('Copy failed. Select the link and copy it')).toBeInTheDocument();
    expect(screen.queryByText('Link copied')).not.toBeInTheDocument();
  });

  it('Sync now reports what the sync actually did, not a blanket "Synced"', async () => {
    const result = (status: string, error: string | null = null) =>
      vi.mocked(api).mockResolvedValueOnce({ status, added: 0, updated: 0, removed: 0, error });
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <CalendarSyncPanel unitId="u1" canWrite />
      </SWRConfig>,
    );
    await screen.findByText(/Failing: Calendar link not found \(404\)/);
    const sync = screen.getByRole('button', { name: 'Sync now' });
    // The sync endpoint answers 200 even when the fetch failed — the panel must read the result.
    result('error', 'Calendar link not found (404)');
    await userEvent.click(sync);
    expect(await screen.findByText('Sync failed: Calendar link not found (404)')).toBeInTheDocument();
    result('not_modified');
    await userEvent.click(sync);
    expect(await screen.findByText('No changes')).toBeInTheDocument();
    result('ok');
    await userEvent.click(sync);
    expect(await screen.findByText('Synced')).toBeInTheDocument();
  });
});
