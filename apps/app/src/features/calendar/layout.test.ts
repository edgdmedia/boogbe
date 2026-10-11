import { describe, expect, it } from 'vitest';
import type { CalendarItem } from '@boogbe/shared';
import { layoutBars } from './layout';

const block = (start: string, end: string): CalendarItem => ({
  kind: 'block',
  id: start,
  unitId: 'u',
  start,
  end,
  source: 'manual',
  reason: 'maintenance',
  label: 'Maintenance',
});

describe('layoutBars', () => {
  it('positions an item fully inside the window', () => {
    expect(layoutBars([block('2026-11-03', '2026-11-05')], '2026-11-01', 14)[0]).toMatchObject({
      col: 2,
      span: 2,
      clippedStart: false,
      clippedEnd: false,
    });
  });
  it('clips items that start before or end after the window', () => {
    expect(layoutBars([block('2026-10-28', '2026-11-02')], '2026-11-01', 14)[0]).toMatchObject({ col: 0, span: 1, clippedStart: true });
    expect(layoutBars([block('2026-11-13', '2026-11-20')], '2026-11-01', 14)[0]).toMatchObject({ col: 12, span: 2, clippedEnd: true });
  });
  it('drops items outside the window', () => {
    expect(layoutBars([block('2026-12-01', '2026-12-02')], '2026-11-01', 14)).toEqual([]);
  });
});
