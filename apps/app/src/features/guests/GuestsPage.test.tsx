import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { GuestsPage } from './GuestsPage';

const g = (id: string, fullName: string) => ({
  id,
  fullName,
  phoneE164: `+23480${id}`.slice(0, 14),
  email: null,
  notes: null,
  bookingCount: 0,
  lifetimeValueKobo: 0,
  lastStayAt: null,
});
const page1 = { items: [g('1', 'Adaeze Okafor')], nextCursor: 'c2' };
const page2 = { items: [g('2', 'Zainab Yusuf')], nextCursor: null };

vi.mock('../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../lib/api')>();
  return {
    ...real,
    api: vi.fn(async (path: string) => (path.includes('cursor=c2') ? page2 : page1)),
    useApi: (path: string | null) => ({
      // fresh object identities per render, like SWR revalidation
      data: path
        ? path.includes('cursor=c2')
          ? { ...page2, items: [...page2.items] }
          : path.startsWith('/v1/guests?')
            ? { ...page1, items: [...page1.items] }
            : undefined
        : undefined,
      mutate: vi.fn(),
    }),
  };
});

describe('GuestsPage paging [GST-02]', () => {
  it('appends the next page on Load more', async () => {
    const { rerender } = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter>
          <GuestsPage />
        </MemoryRouter>
      </SWRConfig>,
    );
    expect(await screen.findByText('Adaeze Okafor')).toBeInTheDocument();
    expect(screen.queryByText('Zainab Yusuf')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /load more/i }));
    await waitFor(() => expect(screen.getByText('Zainab Yusuf')).toBeInTheDocument());
    expect(screen.getByText('Adaeze Okafor')).toBeInTheDocument(); // appended, not replaced
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull(); // page 2 is last

    // revalidation delivering fresh objects must replace, not duplicate (review item 3)
    rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter>
          <GuestsPage />
        </MemoryRouter>
      </SWRConfig>,
    );
    await waitFor(() => {
      const table = screen.getByRole('table');
      expect(within(table).getAllByText('Zainab Yusuf')).toHaveLength(1);
      expect(within(table).getAllByText('Adaeze Okafor')).toHaveLength(1);
    });
  });

  it('resets paging when the search changes', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter>
          <GuestsPage />
        </MemoryRouter>
      </SWRConfig>,
    );
    await screen.findByText('Adaeze Okafor');
    await userEvent.click(screen.getByRole('button', { name: /load more/i }));
    await screen.findByText('Zainab Yusuf');
    await userEvent.type(screen.getByLabelText('Search guests'), 'oka');
    // new query drops the cursor: page-2-only rows disappear once the new first page renders
    await waitFor(() => expect(screen.queryByText('Zainab Yusuf')).toBeNull());
  });
});
