import type { IsoDate } from '@boogbe/shared';

export interface IcsEvent {
  uid: string;
  /** All-day range `[start, end)`. */
  start: IsoDate;
  end: IsoDate;
  summary: string;
}

// RFC 5545 §3.3.11: backslash, semicolon, comma and newlines are escaped in TEXT values.
const text = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const date = (d: IsoDate) => d.replace(/-/g, '');
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** RFC 5545 §3.1: lines longer than 75 octets continue on the next line after CRLF + space, never splitting a character. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (bytes + n > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** Minimal PUBLISH calendar of all-day events (ICS-04). Kept in-house: the output is small and fully specified. */
export function renderIcs(cal: { name: string; events: IcsEvent[] }, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Boogbe//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${text(cal.name)}`,
  ];
  for (const e of cal.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${date(e.start)}`,
      `DTEND;VALUE=DATE:${date(e.end)}`,
      `SUMMARY:${text(e.summary)}`,
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
