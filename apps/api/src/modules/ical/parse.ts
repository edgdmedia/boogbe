import ical, { type VEvent } from 'node-ical';
import { addDays, todayIn, type IsoDate } from '@boogbe/shared';
import { FetchError } from './fetcher';

export interface ParsedEvent {
  uid: string;
  start: IsoDate;
  end: IsoDate;
  summary: string;
}

const localParts = (d: Date): IsoDate =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * node-ical builds date-only and floating values with the server's local clock, so reading them back with
 * local getters returns the calendar date as written, whatever TZ the process runs in. Zoned date-times
 * become the local date in the operator's `timeZone`.
 */
function toLocalDate(d: Date & { dateOnly?: boolean; tz?: string }, timeZone: string): IsoDate {
  if (d.dateOnly || !d.tz) return localParts(d);
  return todayIn(timeZone, d);
}

/** Normalises a feed to all-day `[start, end)` ranges (ICS-02). Cancelled and long-past events are dropped. */
export function parseFeed(text: string, timeZone: string, today: IsoDate): ParsedEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new FetchError('Not a calendar file');
  let data: ReturnType<typeof ical.sync.parseICS>;
  try {
    data = ical.sync.parseICS(text);
  } catch {
    throw new FetchError('Not a calendar file');
  }
  const cutoff = addDays(today, -1);
  const out: ParsedEvent[] = [];
  for (const v of Object.values(data)) {
    if (!v || v.type !== 'VEVENT') continue;
    const e = v as VEvent;
    if (String(e.status ?? '').toUpperCase() === 'CANCELLED' || !e.start) continue;
    const start = toLocalDate(e.start as never, timeZone);
    let end = e.end ? toLocalDate(e.end as never, timeZone) : addDays(start, 1);
    if (end <= start) end = addDays(start, 1);
    if (end < cutoff) continue;
    const summary =
      typeof e.summary === 'string'
        ? e.summary
        : ((e.summary as { val?: string } | undefined)?.val ?? 'External booking');
    out.push({
      uid: String(e.uid ?? `${start}-${end}-${summary}`),
      start,
      end,
      summary: summary.slice(0, 200),
    });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
