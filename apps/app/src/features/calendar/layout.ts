import { addDays, nightsBetween, type CalendarItem, type IsoDate } from '@boogbe/shared';

export function layoutBars(items: CalendarItem[], from: IsoDate, days: number) {
  const to = addDays(from, days);
  return items
    .filter((i) => i.start < to && i.end > from)
    .map((item) => {
      const s = item.start < from ? from : item.start;
      const e = item.end > to ? to : item.end;
      return {
        item,
        col: s === from ? 0 : nightsBetween(from, s),
        span: nightsBetween(s, e),
        clippedStart: item.start < from,
        clippedEnd: item.end > to,
      };
    });
}
