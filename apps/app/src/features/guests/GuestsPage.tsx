import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Dialog, EmptyState, Input, Spinner, Table } from '@boogbe/ui';
import { formatDate, formatNaira } from '../../lib/format';
import { GuestForm } from './GuestForm';
import { useGuests } from './hooks';

export function GuestsPage() {
  const [q, setQ] = useState('');
  const { data, mutate } = useGuests(q);
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Guests</h1>
        <Input aria-label="Search guests" placeholder="Search name, phone, email" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        <Button onClick={() => setOpen(true)}>Add guest</Button>
      </div>
      {!data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <EmptyState title="No guests found" />
      ) : (
        <Table
          rows={data.items}
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
      <Dialog open={open} onClose={() => setOpen(false)} title="Add guest">
        <GuestForm
          onSaved={async (g) => {
            setOpen(false);
            await mutate();
            nav(`/guests/${g.id}`);
          }}
        />
      </Dialog>
    </div>
  );
}
