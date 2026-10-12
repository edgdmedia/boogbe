import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFeed } from './parse';

const fx = (n: string) => readFileSync(resolve(__dirname, '../../../test/fixtures/ical', n), 'utf8');
const TODAY = '2026-10-10';

describe('parseFeed [ICS-02]', () => {
  it('parses Airbnb all-day events and drops old ones', () => {
    expect(parseFeed(fx('airbnb.ics'), 'Africa/Lagos', TODAY)).toEqual([
      { uid: '1418fb94e984-a1b2c3@airbnb.com', start: '2026-11-01', end: '2026-11-04', summary: 'Reserved' },
      {
        uid: '1418fb94e984-d4e5f6@airbnb.com',
        start: '2026-12-08',
        end: '2026-12-10',
        summary: 'Airbnb (Not available)',
      },
    ]);
  });
  it('parses Booking.com and VRBO', () => {
    expect(parseFeed(fx('booking_com.ics'), 'Africa/Lagos', TODAY)).toEqual([
      {
        uid: 'bdc-77812@booking.com',
        start: '2026-11-15',
        end: '2026-11-17',
        summary: 'CLOSED - Not available',
      },
    ]);
    expect(parseFeed(fx('vrbo.ics'), 'Africa/Lagos', TODAY)).toHaveLength(1);
  });
  it('maps timed events to local dates and fixes zero-length ones', () => {
    expect(parseFeed(fx('datetime-events.ics'), 'Africa/Lagos', TODAY)).toEqual([
      { uid: 'dt-utc', start: '2026-11-01', end: '2026-11-04', summary: 'Timed UTC' },
      { uid: 'dt-floating', start: '2026-11-10', end: '2026-11-11', summary: 'Floating' },
      { uid: 'dt-zero', start: '2026-11-25', end: '2026-11-26', summary: 'Zero length' },
    ]);
  });
  it('a UTC time just before midnight lands on the next local day in Lagos', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:late',
      'DTSTART:20261101T233000Z',
      'DTEND:20261103T233000Z',
      'SUMMARY:Late',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseFeed(ics, 'Africa/Lagos', TODAY)).toEqual([
      { uid: 'late', start: '2026-11-02', end: '2026-11-04', summary: 'Late' },
    ]);
  });
  it('skips cancelled events; empty calendars are fine; HTML is rejected', () => {
    expect(parseFeed(fx('cancelled.ics'), 'Africa/Lagos', TODAY)).toEqual([]);
    expect(parseFeed(fx('empty.ics'), 'Africa/Lagos', TODAY)).toEqual([]);
    expect(() => parseFeed(fx('malformed.ics'), 'Africa/Lagos', TODAY)).toThrow('Not a calendar file');
  });
});
