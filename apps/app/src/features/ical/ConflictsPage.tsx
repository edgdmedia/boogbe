import clsx from 'clsx';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CHANNEL_LABELS, type SyncConflict } from '@boogbe/shared';
import { Button, Card, Dialog, EmptyState, PageHeader, Spinner } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useConflicts } from './hooks';
import { CancelForConflictForm } from './ResolveConflictDialog';

export function ConflictsPage() {
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const { data, mutate } = useConflicts(tab);
  const [cancel, setCancel] = useState<SyncConflict | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const act = async (c: SyncConflict, action: 'external' | 'moved_booking') => {
    try {
      await api(`/v1/ical/conflicts/${c.id}/resolve`, { method: 'POST', body: { action } });
      await mutate();
    } catch (x) {
      setErr({ ...err, [c.id]: x instanceof ApiError ? x.message : String(x) });
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Channel conflicts"
        actions={
          <div role="group" aria-label="Show" className="inline-flex rounded-control bg-surface-2 p-1">
            {(['open', 'resolved'] as const).map((t) => (
              <button
                key={t}
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
                className={clsx('min-h-10 rounded-[10px] px-4 text-sm font-semibold', tab === t ? 'bg-surface text-ink shadow-card' : 'text-ink-muted')}
              >
                {t === 'open' ? 'Open' : 'Resolved'}
              </button>
            ))}
          </div>
        }
      />
      {!data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <EmptyState title={tab === 'open' ? 'No conflicts — calendars agree' : 'Nothing resolved yet'} />
      ) : (
        data.items.map((c) => {
          const ch = c.block.channel ? CHANNEL_LABELS[c.block.channel] : 'Another channel';
          return (
            <Card key={c.id} className="flex flex-col gap-2">
              <p className="font-medium">
                {c.unit.name}: <Link to={`/bookings/${c.booking.id}`} className="text-brand">{c.booking.ref}</Link> ({c.booking.guestName},{' '}
                {formatDate(c.booking.checkIn)} – {formatDate(c.booking.checkOut)})
              </p>
              <p className="text-sm">
                {ch} shows {formatDate(c.block.start)} – {formatDate(c.block.end)} as taken ({c.block.summary}).
              </p>
              {c.status === 'open' ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => act(c, 'external')}>
                    It&apos;s handled on {ch}
                  </Button>
                  <Button variant="danger" onClick={() => setCancel(c)}>
                    Cancel Boogbe booking
                  </Button>
                  <Button variant="secondary" onClick={() => act(c, 'moved_booking')}>
                    I moved the booking
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-ink-muted">Resolved: {c.resolution?.replace('_', ' ')}</p>
              )}
              {err[c.id] && (
                <p role="alert" className="text-sm text-danger">
                  {err[c.id]}
                </p>
              )}
            </Card>
          );
        })
      )}
      <Dialog open={!!cancel} onClose={() => setCancel(null)} title="Cancel the Boogbe booking">
        {cancel && (
          <CancelForConflictForm
            conflict={cancel}
            onDone={async () => {
              setCancel(null);
              await mutate();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
