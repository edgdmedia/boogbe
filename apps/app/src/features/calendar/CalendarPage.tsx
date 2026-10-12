import { useEffect, useState } from 'react';
import { addDays, todayIn, type CalendarItem } from '@boogbe/shared';
import { Button, Dialog, EmptyState, Input, Spinner } from '@boogbe/ui';
import { api } from '../../lib/api';
import { useMe } from '../../lib/use-me';
import { BlockForm } from './BlockDialog';
import { CalendarGrid } from './CalendarGrid';
import { DayList } from './DayList';
import { useCalendar } from './use-calendar';

const useNarrow = () => {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 767px)');
    const h = () => setNarrow(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return narrow;
};

export function CalendarPage() {
  const { me } = useMe();
  const narrow = useNarrow();
  const today = todayIn(me?.activeOrg?.timezone ?? 'Africa/Lagos');
  const [from, setFrom] = useState(addDays(today, -1));
  const [day, setDay] = useState(today);
  const days = narrow ? 1 : 14;
  // narrow window starts the day before so stays ending today appear under 'Leaving'
  const { data, mutate } = useCalendar(narrow ? addDays(day, -1) : from, narrow ? 3 : days);
  const [sel, setSel] = useState<{ unitId: string; start: string; end: string } | null>(null);
  const [item, setItem] = useState<CalendarItem | null>(null);
  if (!data) return <Spinner />;
  if (!data.properties.length) return <EmptyState title="No units yet" body="Add your properties and units in Settings → Properties." />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Calendar</h1>
        {narrow ? (
          <>
            <Button variant="secondary" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">
              ‹
            </Button>
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day" className="w-40" />
            <Button variant="secondary" onClick={() => setDay(addDays(day, 1))} aria-label="Next day">
              ›
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setFrom(addDays(from, -7))}>
              ‹ Week
            </Button>
            <Button variant="secondary" onClick={() => setFrom(addDays(today, -1))}>
              Today
            </Button>
            <Button variant="secondary" onClick={() => setFrom(addDays(from, 7))}>
              Week ›
            </Button>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Jump to date" className="w-40" />
          </>
        )}
      </div>
      {narrow ? (
        <DayList data={data} day={day} onItemClick={setItem} onNew={(unitId) => setSel({ unitId, start: day, end: addDays(day, 1) })} />
      ) : (
        <CalendarGrid data={data} onEmptySelect={(unitId, start, end) => setSel({ unitId, start, end })} onItemClick={setItem} />
      )}
      <Dialog open={!!sel} onClose={() => setSel(null)} title="Block dates">
        {sel && (
          <BlockForm
            {...sel}
            onSaved={async () => {
              setSel(null);
              await mutate();
            }}
          />
        )}
      </Dialog>
      <Dialog open={item?.kind === 'block'} onClose={() => setItem(null)} title={item?.kind === 'block' ? item.label : ''}>
        {item?.kind === 'block' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {item.start} → {item.end}
            </p>
            {item.source === 'manual' ? (
              <Button
                variant="danger"
                onClick={async () => {
                  await api(`/v1/blocks/${item.id}`, { method: 'DELETE' });
                  setItem(null);
                  await mutate();
                }}
              >
                Remove block
              </Button>
            ) : (
              <p className="text-sm text-ink-muted">This came from a synced calendar. Change it there.</p>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
