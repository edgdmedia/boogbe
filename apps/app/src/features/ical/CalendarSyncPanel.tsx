import { formatDistanceToNow } from 'date-fns';
import { useState } from 'react';
import { CHANNEL_LABELS, SyncResult, type IcalExport, type IcalFeed } from '@boogbe/shared';
import { Badge, Button, Spinner } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { AddFeedForm } from './AddFeedForm';
import { EXPORT_HELP } from './channel-help';
import { useUnitIcal } from './hooks';

const status = (f: IcalFeed) =>
  f.lastStatus === 'error' ? (
    <Badge tone="danger">Failing: {f.lastError}</Badge>
  ) : f.lastSyncedAt ? (
    <Badge tone="success">Synced {formatDistanceToNow(new Date(f.lastSyncedAt))} ago</Badge>
  ) : (
    <Badge>Waiting for first sync</Badge>
  );

export function CalendarSyncPanel({ unitId, canWrite }: { unitId: string; canWrite: boolean }) {
  const { data, mutate } = useUnitIcal(unitId);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<string>();
  if (!data) return <Spinner />;
  const act = async (p: Promise<unknown>, ok?: string | ((r: unknown) => string)) => {
    setMsg(undefined);
    try {
      const res = await p;
      if (ok) setMsg(typeof ok === 'function' ? ok(res) : ok);
      await mutate();
    } catch (x) {
      setMsg(x instanceof ApiError ? x.message : String(x));
    }
  };
  const channels = [...new Set(data.feeds.map((f) => f.channel))];
  const exportFor = (c: IcalExport['channel']) => data.exports.find((e) => e.channel === c);
  return (
    <div id="calendar-sync" className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Bring bookings in</h3>
        {data.feeds.length === 0 && <p className="text-sm text-ink-muted">No channels connected.</p>}
        {data.feeds.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-2 text-sm">
            <span>
              <span className="font-medium">{f.label}</span> · {f.urlHost} · {f.blockCount} dates {status(f)}
            </span>
            {canWrite && (
              <span className="flex gap-1">
                <Button
                  variant="ghost"
                  onClick={() =>
                    // The endpoint answers 200 with status:'error' when the channel fetch failed — say so, not "Synced".
                    act(api(`/v1/ical/feeds/${f.id}/sync`, { method: 'POST', schema: SyncResult }), (r) => {
                      const res = r as SyncResult;
                      return res.status === 'error'
                        ? `Sync failed: ${res.error}`
                        : res.status === 'not_modified'
                          ? 'No changes'
                          : 'Synced';
                    })
                  }
                >
                  Sync now
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => confirm(`Disconnect ${f.label}? Its dates will be removed from Boogbe.`) && act(api(`/v1/ical/feeds/${f.id}`, { method: 'DELETE' }))}
                >
                  Remove
                </Button>
              </span>
            )}
          </div>
        ))}
        {canWrite &&
          (adding ? (
            <AddFeedForm
              unitId={unitId}
              onSaved={async () => {
                setAdding(false);
                await mutate();
              }}
            />
          ) : (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              Connect a channel
            </Button>
          ))}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Send availability out</h3>
        {[...channels, 'all' as const].map((c) => {
          const ex = exportFor(c);
          return (
            <div key={c} className="rounded-lg border border-line p-2 text-sm">
              <p className="font-medium">{CHANNEL_LABELS[c]}</p>
              <p className="text-ink-muted">{EXPORT_HELP[c]}</p>
              {ex ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="max-w-full truncate rounded bg-surface-2 px-2 py-1 text-xs">{ex.url}</code>
                  <Button
                    variant="secondary"
                    aria-label={`Copy ${CHANNEL_LABELS[c]} link`}
                    onClick={() => {
                      // writeText rejects (permissions policy, insecure context) — never claim a copy we didn't make.
                      navigator.clipboard.writeText(ex.url).then(
                        () => setMsg('Link copied'),
                        () => setMsg('Copy failed. Select the link and copy it'),
                      );
                    }}
                  >
                    Copy
                  </Button>
                  {canWrite && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        confirm('Make a new link? The old one stops working — paste the new one into the channel.') &&
                        act(api(`/v1/ical/exports/${ex.id}/rotate`, { method: 'POST' }), 'New link created')
                      }
                    >
                      New link
                    </Button>
                  )}
                </div>
              ) : (
                canWrite && (
                  <Button
                    variant="secondary"
                    className="mt-1"
                    onClick={() => act(api('/v1/ical/exports', { method: 'POST', body: { unitId, channel: c } }))}
                  >
                    Create link
                  </Button>
                )
              )}
            </div>
          );
        })}
      </section>
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </div>
  );
}
