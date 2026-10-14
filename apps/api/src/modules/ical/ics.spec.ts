import { describe, expect, it } from 'vitest';
import { parseFeed } from './parse';
import { renderIcs } from './ics';

const NOW = new Date('2026-10-13T09:30:00Z');
const cal = (events: Parameters<typeof renderIcs>[0]['events'], name = 'Kairo – Tanuhomes') => renderIcs({ name, events }, NOW);

describe('renderIcs [ICS-04]', () => {
  it('writes all-day events with stable UIDs, CRLF line ends and a DTSTAMP', () => {
    const out = cal([{ uid: 'booking-b1@boogbe', start: '2026-11-04', end: '2026-11-07', summary: 'Reserved' }]);
    expect(out.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(out.split('\r\n').join('\n')).not.toContain('\r');
    expect(out).toContain('METHOD:PUBLISH\r\n');
    expect(out).toContain('UID:booking-b1@boogbe\r\n');
    expect(out).toContain('DTSTAMP:20261013T093000Z\r\n');
    expect(out).toContain('DTSTART;VALUE=DATE:20261104\r\n');
    expect(out).toContain('DTEND;VALUE=DATE:20261107\r\n');
    expect(out).toContain('SUMMARY:Reserved\r\n');
  });

  it('escapes text and folds long lines at 75 octets', () => {
    const name = 'Unit; with, commas\\ and a very long name that goes past seventy-five octets – Tanuhomes Ltd';
    const out = cal([], name);
    const lines = out.split('\r\n');
    expect(lines.every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    const unfolded = out.replace(/\r\n /g, '');
    expect(unfolded).toContain('X-WR-CALNAME:Unit\\; with\\, commas\\\\ and a very long name');
  });

  it('never splits a multi-byte character when folding', () => {
    const out = cal([], '–'.repeat(40));
    expect(out).not.toContain('�');
    expect(Buffer.from(out, 'utf8').toString('utf8')).toBe(out);
    expect(out.replace(/\r\n /g, '')).toContain(`X-WR-CALNAME:${'–'.repeat(40)}`);
  });

  it('round-trips through our own importer', () => {
    const out = cal([
      { uid: 'booking-b1@boogbe', start: '2026-11-04', end: '2026-11-07', summary: 'Reserved' },
      { uid: 'block-k1@boogbe', start: '2026-11-10', end: '2026-11-11', summary: 'Blocked' },
    ]);
    const events = parseFeed(out, 'Africa/Lagos', '2026-10-13');
    expect(events).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uid: 'booking-b1@boogbe', start: '2026-11-04', end: '2026-11-07' }),
        expect.objectContaining({ uid: 'block-k1@boogbe', start: '2026-11-10', end: '2026-11-11' }),
      ]),
    );
  });
});
