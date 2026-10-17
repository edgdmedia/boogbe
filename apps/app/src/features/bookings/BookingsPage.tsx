import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookingSourceEnum, SOURCE_LABELS, STATUS_LABELS } from '@boogbe/shared';
import { Badge, Card, EmptyState, Input, PageHeader, Select, Spinner, Table } from '@boogbe/ui';
import { formatDate, formatNaira } from '../../lib/format';
import { useBookings } from './hooks';
import { WebsiteBadge } from './WebsiteBadge';
import { WebsiteRequestsCard } from './WebsiteRequestsCard';

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
      <PageHeader title="Bookings" />
      <WebsiteRequestsCard />
      <Card className="grid gap-2 p-3 md:grid-cols-5">
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
      </Card>
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
            { key: 'u', header: 'Unit', cell: (b) => b.unitName, hideOnMobile: true },
            { key: 'd', header: 'Dates', cell: (b) => `${formatDate(b.checkIn)} → ${formatDate(b.checkOut)}` },
            { key: 's', header: 'Status', cell: (b) => (
                <span className="flex flex-wrap gap-1">
                  <Badge>{STATUS_LABELS[b.status]}</Badge>
                  <WebsiteBadge source={b.source} />
                </span>
              ),
            },
            { key: 't', header: 'Total', cell: (b) => formatNaira(b.finalTotalKobo), className: 'num text-right', hideOnMobile: true },
            { key: 'bal', header: 'Balance', cell: (b) => (b.balanceKobo === null ? '—' : formatNaira(b.balanceKobo)), className: 'num text-right' },
          ]}
        />
      )}
      {data?.nextCursor && (
        <button className="min-h-11 self-center px-4 text-sm font-semibold text-brand" onClick={() => setCursor(data.nextCursor)}>
          Load more
        </button>
      )}
    </div>
  );
}
