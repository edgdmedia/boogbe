import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookingSourceEnum, SOURCE_LABELS, STATUS_LABELS } from '@boogbe/shared';
import { Badge, EmptyState, Input, Select, Spinner, Table } from '@boogbe/ui';
import { formatDate, formatNaira } from '../../lib/format';
import { useBookings } from './hooks';

export function BookingsPage() {
  const nav = useNavigate();
  const [f, setF] = useState({ q: '', status: '', source: '', from: '', to: '' });
  const [cursor, setCursor] = useState<string | null>(null);
  const qs = new URLSearchParams(
    Object.entries({ ...f, ...(cursor && { cursor }) }).filter(([, v]) => v) as [string, string][],
  ).toString();
  const { data } = useBookings(qs);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Bookings</h1>
      <div className="grid gap-2 md:grid-cols-5">
        <Input aria-label="Search" placeholder="Ref, guest or phone" value={f.q} onChange={(e) => { setCursor(null); setF({ ...f, q: e.target.value }); }} />
        <Select aria-label="Status" value={f.status} onChange={(e) => { setCursor(null); setF({ ...f, status: e.target.value }); }}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <Select aria-label="Source" value={f.source} onChange={(e) => { setCursor(null); setF({ ...f, source: e.target.value }); }}>
          <option value="">All channels</option>
          {BookingSourceEnum.options.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </Select>
        <Input aria-label="From" type="date" value={f.from} onChange={(e) => { setCursor(null); setF({ ...f, from: e.target.value }); }} />
        <Input aria-label="To" type="date" value={f.to} onChange={(e) => { setCursor(null); setF({ ...f, to: e.target.value }); }} />
      </div>
      {!data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <EmptyState title="No bookings match" />
      ) : (
        <Table
          rows={data.items}
          onRowClick={(b) => nav(`/bookings/${b.id}`)}
          columns={[
            { key: 'ref', header: 'Ref', cell: (b) => b.ref },
            { key: 'g', header: 'Guest', cell: (b) => b.guestName },
            { key: 'u', header: 'Unit', cell: (b) => b.unitName },
            { key: 'd', header: 'Dates', cell: (b) => `${formatDate(b.checkIn)} → ${formatDate(b.checkOut)}` },
            { key: 's', header: 'Status', cell: (b) => <Badge>{STATUS_LABELS[b.status]}</Badge> },
            { key: 't', header: 'Total', cell: (b) => formatNaira(b.finalTotalKobo), className: 'text-right' },
            { key: 'bal', header: 'Balance', cell: (b) => (b.balanceKobo === null ? '—' : formatNaira(b.balanceKobo)), className: 'text-right' },
          ]}
        />
      )}
      {data?.nextCursor && (
        <button className="self-center text-sm text-brand" onClick={() => setCursor(data.nextCursor)}>
          Load more
        </button>
      )}
    </div>
  );
}
