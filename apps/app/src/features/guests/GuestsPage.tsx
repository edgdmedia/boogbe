import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Guest } from '@boogbe/shared';
import { Button, Dialog, EmptyState, Input, Spinner, Table } from '@boogbe/ui';
import { formatDate, formatNaira } from '../../lib/format';
import { GuestForm } from './GuestForm';
import { useGuests } from './hooks';

type Page = { key: string; items: Guest[]; nextCursor: string | null };

export function GuestsPage() {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const { data, mutate } = useGuests(q, cursor);
  // pages keyed by the cursor that requested them ('' = first page): a revalidation that hands
  // back a fresh object for the same page replaces it instead of duplicating rows
  const [pages, setPages] = useState<Page[]>([]);
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const search = (value: string) => {
    setQ(value);
    setCursor(null); // never fire the new search with a stale keyset cursor
    setPages([]); // old results belong to the old query
  };
  useEffect(() => {
    if (!data) return;
    const key = cursor ?? '';
    setPages((prev) => {
      const i = prev.findIndex((p) => p.key === key);
      const page: Page = { key, items: data.items, nextCursor: data.nextCursor };
      if (i >= 0) {
        const old = prev[i]!;
        // revalidations that hand back an equal payload (new object identity) must not re-render
        if (
          old.nextCursor === page.nextCursor &&
          old.items.length === page.items.length &&
          old.items.every((x, j) => x.id === page.items[j]!.id)
        ) {
          return prev;
        }
        const next = [...prev];
        next[i] = page;
        return next;
      }
      return [...prev, page];
    });
  }, [data, cursor]);
  const rows = pages.flatMap((p) => p.items);
  const last = pages[pages.length - 1];
  const loadingPage = !!cursor && !data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Guests</h1>
        <Input
          aria-label="Search guests"
          placeholder="Search name, phone, email"
          value={q}
          onChange={(e) => search(e.target.value)}
          className="w-64"
        />
        <Button onClick={() => setOpen(true)}>Add guest</Button>
      </div>
      {rows.length === 0 && !data ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState title="No guests found" />
      ) : (
        <Table
          rows={rows}
          onRowClick={(g) => nav(`/guests/${g.id}`)}
          columns={[
            { key: 'n', header: 'Name', cell: (g) => g.fullName },
            { key: 'p', header: 'Phone', cell: (g) => g.phoneE164 },
            { key: 'b', header: 'Stays', cell: (g) => g.bookingCount },
            { key: 'v', header: 'Lifetime value', cell: (g) => formatNaira(g.lifetimeValueKobo) },
            { key: 'l', header: 'Last stay', cell: (g) => (g.lastStayAt ? formatDate(g.lastStayAt) : '—') },
          ]}
        />
      )}
      {(last?.nextCursor || loadingPage) && (
        <button
          className="self-center text-sm text-brand disabled:opacity-50"
          disabled={loadingPage}
          onClick={() => setCursor(last?.nextCursor ?? null)}
        >
          {loadingPage ? 'Loading…' : 'Load more'}
        </button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Add guest">
        <GuestForm
          onSaved={async (g) => {
            setOpen(false);
            setCursor(null);
            setPages([]);
            await mutate();
            nav(`/guests/${g.id}`);
          }}
        />
      </Dialog>
    </div>
  );
}
