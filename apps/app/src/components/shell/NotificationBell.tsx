import { Bell, Globe } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { NotificationList } from '@boogbe/shared';
import { api } from '../../lib/api';

export function NotificationBell() {
  const { data, mutate } = useSWR('/v1/notifications', (p: string) => api(p, { schema: NotificationList }), { refreshInterval: 60_000 });
  const [open, setOpen] = useState(false);
  const unread = data?.unreadCount ?? 0;
  return (
    <div className="relative">
      <button
        aria-label={`Notifications, ${unread} unread`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="relative grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-surface-2"
      >
        <Bell size={20} aria-hidden />
        {unread > 0 && <span className="absolute right-1 top-1 rounded-full bg-danger px-1.5 text-[10px] font-semibold text-danger-ink">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-80 rounded-[var(--radius-card)] border border-line bg-surface p-2 shadow-lg">
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="font-semibold">Notifications</span>
            <button
              className="text-xs text-brand"
              onClick={async () => {
                await api('/v1/notifications/read-all', { method: 'POST' });
                await mutate();
              }}
            >
              Mark all read
            </button>
          </div>
          {data?.items.length ? (
            data.items.map((n) => (
              <Link
                key={n.id}
                to={n.link ?? '#'}
                onClick={async () => {
                  setOpen(false);
                  if (!n.readAt) {
                    await api(`/v1/notifications/${n.id}/read`, { method: 'POST' });
                    await mutate();
                  }
                }}
                className={`block rounded-lg px-2 py-2 text-sm hover:bg-surface-2 ${n.readAt ? 'text-ink-muted' : 'font-medium'}`}
              >
                {n.kind === 'website_request' && (
                  <Globe size={14} aria-hidden data-kind-icon="website_request" className="mr-1 inline-block align-[-2px] text-info" />
                )}
                {n.title}
                {n.body && <span className="block text-xs font-normal text-ink-muted">{n.body}</span>}
              </Link>
            ))
          ) : (
            <p className="px-2 py-4 text-sm text-ink-muted">Nothing new</p>
          )}
        </div>
      )}
    </div>
  );
}
