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
        <section key={s.title} aria-label={s.title}>
          <h2 className="mb-2 text-sm font-semibold text-ink-muted">{s.title} ({s.items.length})</h2>
          {s.items.length === 0 ? (
            <p className="text-sm text-ink-muted">None</p>
          ) : (
            s.items.map((i) => (
              <button key={`${i.kind}-${i.id}`} className="mb-2 block w-full text-left" onClick={() => onItemClick(i)}>
                <Card>
                  <p className="font-medium">{name(i.unitId)}</p>
                  <p className="text-sm text-ink-muted">
                    {i.kind === 'booking' ? `${i.guestName ?? 'Guest'} · ${i.ref}` : i.label}
                  </p>
                </Card>
              </button>
            ))
          )}
        </section>
      ))}
      <section aria-label="Free tonight">
        <h2 className="mb-2 text-sm font-semibold text-ink-muted">Free tonight ({free.length})</h2>
        {free.length === 0 ? (
          <EmptyState title="Fully booked tonight" />
        ) : (
          free.map((u) => (
            <Card key={u.id} className="mb-2 flex items-center justify-between">
              <span>
                {u.name} <span className="text-sm text-ink-muted">{u.property}</span>
              </span>
              <Button variant="secondary" onClick={() => onNew(u.id)}>
                Block / book
              </Button>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
