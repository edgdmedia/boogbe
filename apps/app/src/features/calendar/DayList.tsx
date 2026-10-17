import type { CalendarItem, CalendarResponse } from '@boogbe/shared';
import { Button, Card, EmptyState } from '@boogbe/ui';

export function DayList({
  data,
  day,
  onItemClick,
  onNew,
}: {
  data: CalendarResponse;
  day: string;
  onItemClick: (i: CalendarItem) => void;
  onNew: (unitId: string) => void;
}) {
  const units = data.properties.flatMap((p) => p.units.map((u) => ({ ...u, property: p.name })));
  const name = (id: string) => units.find((u) => u.id === id)?.name ?? '';
  const sections = [
    { title: 'Arriving', items: data.items.filter((i) => i.start === day) },
    { title: 'Leaving', items: data.items.filter((i) => i.end === day) },
    { title: 'In house / blocked', items: data.items.filter((i) => i.start < day && i.end > day) },
  ];
  const free = units.filter((u) => !data.items.some((i) => i.unitId === u.id && i.start <= day && i.end > day));
  return (
    <div className="flex flex-col gap-4">
      {sections.map((s) => (
        <Card key={s.title} role="region" aria-label={s.title} className="flex flex-col gap-2">
          <h2 className="mb-2 text-[17px] font-bold tracking-[-0.01em] text-ink">
            {s.title} ({s.items.length})
          </h2>
          {s.items.length === 0 ? (
            <p className="text-sm text-ink-muted">None</p>
          ) : (
            s.items.map((i) => (
              <button
                key={`${i.kind}-${i.id}`}
                className="block min-h-11 w-full rounded-control border border-line px-3 py-2.5 text-left hover:bg-surface-2"
                onClick={() => onItemClick(i)}
              >
                <p className="font-semibold">{name(i.unitId)}</p>
                <p className="text-sm text-ink-muted">{i.kind === 'booking' ? `${i.guestName ?? 'Guest'} · ${i.ref}` : i.label}</p>
              </button>
            ))
          )}
        </Card>
      ))}
      <Card role="region" aria-label="Free tonight" className="flex flex-col gap-2">
        <h2 className="mb-2 text-[17px] font-bold tracking-[-0.01em] text-ink">Free tonight ({free.length})</h2>
        {free.length === 0 ? (
          <EmptyState title="Fully booked tonight" />
        ) : (
          free.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-2 rounded-control border border-line px-3 py-2">
              <span>
                <span className="font-semibold">{u.name}</span> <span className="text-sm text-ink-muted">{u.property}</span>
              </span>
              <Button variant="secondary" onClick={() => onNew(u.id)}>
                Block / book
              </Button>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
