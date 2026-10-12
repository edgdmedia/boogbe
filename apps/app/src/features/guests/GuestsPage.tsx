import { useEffect, useState } from 'react';
import type { Guest } from '@boogbe/shared';
import { useNavigate } from 'react-router-dom';
import { Button, Dialog, EmptyState, Input, Spinner, Table } from '@boogbe/ui';
import { formatDate, formatNaira } from '../../lib/format';
import { GuestForm } from './GuestForm';
import { useGuests } from './hooks';

export function GuestsPage() {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const { data, mutate } = useGuests(q, cursor);
  const [acc, setAcc] = useState<Guest[] | null>(null);
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setCursor(null);
    setAcc(null); // new search restarts paging
  }, [q]);
  useEffect(() => {
    if (!data) return;
    setAcc((prev) => (cursor ? [...(prev ?? []), ...data.items] : data.items));
  }, [data]); // eslint-disable-next-line react-hooks/exhaustive-deps
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Guests</h1>
        <Input aria-label="Search guests" placeholder="Search name, phone, email" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        <Button onClick={() => setOpen(true)}>Add guest</Button>
      </div>
      {!data ? (
        <Spinner />
      ) : (acc ?? data.items).length === 0 ? (
        <EmptyState title="No guests found" />
      ) : (
        <Table
          rows={acc ?? data.items}
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
      {data?.nextCursor && (
        <button className="self-center text-sm text-brand" onClick={() => setCursor(data.nextCursor)}>
          Load more
        </button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Add guest">
        <GuestForm
          onSaved={async (g) => {
            setOpen(false);
            setCursor(null);
            setAcc(null);
            await mutate();
            nav(`/guests/${g.id}`);
          }}
        />
      </Dialog>
    </div>
  );
}
