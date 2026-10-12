import { describe, expect, it } from 'vitest';
import { CHANNEL_LABELS, CreateExportInput, IcalFeedInput, ResolveConflictInput, SyncResult } from './ical';

describe('iCal contracts [ICS-01..06]', () => {
  const feed = {
    unitId: 'u1',
    label: 'Airbnb',
    channel: 'airbnb',
    url: 'https://www.airbnb.com/calendar/ical/1.ics?s=abc',
  };

  it('feed links must be https', () => {
    expect(IcalFeedInput.safeParse(feed).success).toBe(true);
    expect(
      IcalFeedInput.safeParse({ ...feed, url: 'http://www.airbnb.com/calendar/ical/1.ics' }).success,
    ).toBe(false);
    expect(IcalFeedInput.safeParse({ ...feed, url: 'not a url' }).success).toBe(false);
  });

  it('feed label is 2..60 characters and channel is known', () => {
    expect(IcalFeedInput.safeParse({ ...feed, label: 'A' }).success).toBe(false);
    expect(IcalFeedInput.safeParse({ ...feed, label: 'x'.repeat(61) }).success).toBe(false);
    expect(IcalFeedInput.safeParse({ ...feed, channel: 'expedia' }).success).toBe(false);
  });

  it('exports can target one channel or all', () => {
    expect(CreateExportInput.safeParse({ unitId: 'u1', channel: 'all' }).success).toBe(true);
    expect(CreateExportInput.safeParse({ unitId: 'u1', channel: 'booking_com' }).success).toBe(true);
    expect(CreateExportInput.safeParse({ unitId: 'u1', channel: 'nope' }).success).toBe(false);
    expect(CHANNEL_LABELS.all).toBe('All channels');
  });

  it('cancelling a booking over a conflict with a refund needs the refund method', () => {
    expect(ResolveConflictInput.safeParse({ action: 'cancel_booking', refundKobo: 1000 }).success).toBe(
      false,
    );
    expect(
      ResolveConflictInput.safeParse({ action: 'cancel_booking', refundKobo: 1000, refundMethod: 'cash' })
        .success,
    ).toBe(true);
    expect(ResolveConflictInput.safeParse({ action: 'external' }).success).toBe(true);
  });

  it('sync results are typed', () => {
    expect(
      SyncResult.safeParse({ status: 'not_modified', added: 0, updated: 0, removed: 0, error: null }).success,
    ).toBe(true);
  });
});
