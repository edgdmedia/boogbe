import clsx from 'clsx';
import { useState } from 'react';
import { addDays, eachNight, type CalendarItem, type CalendarResponse } from '@boogbe/shared';
import { formatDate } from '../../lib/format';
import { layoutBars } from './layout';

const CELL = 44; // px per day column

const short = (d: string) => formatDate(d).replace(/ \d{4}$/, '');
const TONE: Record<string, string> = {
  tentative: 'bg-warning/20 text-warning border-warning',
  confirmed: 'bg-brand/15 text-brand border-brand',
  checked_in: 'bg-success/20 text-success border-success',
  checked_out: 'bg-surface-2 text-ink-muted border-line',
  manual: 'bg-[repeating-linear-gradient(45deg,var(--color-line)_0_6px,transparent_6px_12px)] text-ink border-line',
  ical: 'bg-surface-2 text-ink-muted border-line',
};
const tone = (i: CalendarItem) => (i.kind === 'booking' ? TONE[i.status] : TONE[i.source]) ?? '';
const label = (i: CalendarItem) =>
  i.kind === 'booking'
    ? `${i.hasConflict ? '⚠ ' : ''}${i.source === 'website' ? 'Web · ' : ''}${i.guestName ?? 'Guest'} · ${i.ref}`
    : i.label;
/** Screen readers get the words the chip abbreviates. */
const spoken = (i: CalendarItem) =>
  i.kind === 'booking' && i.source === 'website'
    ? `${i.status === 'tentative' ? 'Website request' : 'Website booking'} · ${label(i).replace('Web · ', '')}`
    : label(i);

export function CalendarGrid({
  data,
  onEmptySelect,
  onItemClick,
}: {
  data: CalendarResponse;
  onEmptySelect: (unitId: string, start: string, end: string) => void;
  onItemClick: (i: CalendarItem) => void;
}) {
  const days = eachNight(data.from, data.to);
  const [drag, setDrag] = useState<{ unitId: string; a: string; b: string } | null>(null);
  const inDrag = (u: string, d: string) =>
    !!drag && drag.unitId === u && d >= (drag.a < drag.b ? drag.a : drag.b) && d <= (drag.a < drag.b ? drag.b : drag.a);
  const finish = () => {
    if (!drag) return;
    const [s, e] = drag.a < drag.b ? [drag.a, drag.b] : [drag.b, drag.a];
    setDrag(null);
    onEmptySelect(drag.unitId, s, addDays(e, 1));
  };
  return (
    <div
      role="grid"
      aria-label="Calendar"
      className="overflow-x-auto rounded-card border border-line bg-surface shadow-card"
      onMouseLeave={() => setDrag(null)}
    >
      <div style={{ minWidth: 180 + days.length * CELL }}>
        <div role="row" className="sticky top-0 z-10 flex border-b border-line bg-surface">
          <div className="sticky left-0 w-[180px] shrink-0 bg-surface" />
          {days.map((d) => (
            <div
              role="columnheader"
              key={d}
              aria-label={`${short(d)}${d === data.today ? ' today' : ''}`}
              style={{ width: CELL }}
              className={clsx('eyebrow shrink-0 py-2 text-center', d === data.today ? 'text-brand' : 'text-ink-muted')}
            >
              {new Date(`${d}T00:00:00Z`).toLocaleDateString('en-NG', { weekday: 'narrow', timeZone: 'UTC' })}
              <br />
              {Number(d.slice(8))}
            </div>
          ))}
        </div>
        {data.properties.map((p) => (
          <div key={p.id}>
            <div className="eyebrow sticky left-0 bg-surface-2 px-3 py-1.5 text-ink-muted">
              {p.name}
            </div>
            {p.units.map((u) => {
              const bars = layoutBars(
                data.items.filter((i) => i.unitId === u.id),
                data.from,
                days.length,
              );
              return (
                <div role="row" key={u.id} className="relative flex border-t border-line" style={{ height: 48 }}>
                  <div
                    role="rowheader"
                    className="sticky left-0 z-[5] flex w-[180px] shrink-0 items-center bg-surface px-3 text-sm font-medium"
                  >
                    {u.name}
                  </div>
                  {days.map((d) => (
                    <div
                      key={d}
                      role="gridcell"
                      data-testid={`cell-${u.id}-${d}`}
                      style={{ width: CELL }}
                      className={clsx('shrink-0 border-l border-line', d === data.today && 'bg-brand-soft', inDrag(u.id, d) && 'bg-brand/20')}
                      onMouseDown={() => setDrag({ unitId: u.id, a: d, b: d })}
                      onMouseEnter={() => drag?.unitId === u.id && setDrag({ ...drag, b: d })}
                      onMouseUp={finish}
                    />
                  ))}
                  {bars.map(({ item, col, span, clippedStart, clippedEnd }) => (
                    <button
                      key={`${item.kind}-${item.id}`}
                      type="button"
                      onClick={() => onItemClick(item)}
                      aria-label={`${spoken(item)}, ${short(item.start)} – ${short(item.end)}${item.kind === 'booking' && item.hasConflict ? ', possible double booking' : ''}`}
                      className={clsx(
                        'absolute top-1.5 z-[4] h-9 truncate border px-2 text-left text-xs font-semibold shadow-sm', item.kind === 'booking' && item.hasConflict ? 'ring-2 ring-danger' : '',
                        tone(item),
                        clippedStart ? 'rounded-l-none' : 'rounded-l-chip',
                        clippedEnd ? 'rounded-r-none' : 'rounded-r-chip',
                      )}
                      style={{
                        left: 180 + col * CELL + (clippedStart ? 0 : CELL / 2),
                        width: span * CELL - (clippedStart ? 0 : CELL / 2) + (clippedEnd ? 0 : CELL / 2) - 2,
                      }}
                    >
                      {label(item)}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
