import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarResponse } from '@boogbe/shared';
import { CalendarGrid } from './CalendarGrid';
import { layoutBars } from './layout';

const data: CalendarResponse = {
  from: '2026-11-01',
  to: '2026-11-15',
  today: '2026-11-02',
  properties: [
    {
      id: 'p',
      name: 'The Rock',
      units: [{ id: 'u1', name: 'Kairo', bedrooms: 2, maxGuests: 4, nightlyRateKobo: 20_000_000 }],
    },
  ],
  items: [
    { kind: 'block', id: 'b1', unitId: 'u1', start: '2026-11-03', end: '2026-11-05', source: 'manual', reason: 'maintenance', label: 'Maintenance' },
  ],
};

describe('CalendarGrid', () => {
  it('renders units, today marker and bars', () => {
    render(<CalendarGrid data={data} onEmptySelect={vi.fn()} onItemClick={vi.fn()} />);
    expect(screen.getByRole('rowheader', { name: /Kairo/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Maintenance, 3 Nov – 5 Nov/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /2 Nov.*today/i })).toBeInTheDocument();
  });
  it('marks website requests on the booking chip [T-WB-07]', () => {
    const withRequest: CalendarResponse = {
      ...data,
      items: [
        { kind: 'booking', id: 'k1', unitId: 'u1', start: '2026-11-06', end: '2026-11-08', status: 'tentative', source: 'website', ref: 'TAN-7', guestName: 'Ada', balanceKobo: null, hasConflict: false },
        { kind: 'booking', id: 'k2', unitId: 'u1', start: '2026-11-09', end: '2026-11-11', status: 'confirmed', source: 'phone', ref: 'TAN-8', guestName: 'Ben', balanceKobo: null, hasConflict: false },
      ],
    };
    render(<CalendarGrid data={withRequest} onEmptySelect={vi.fn()} onItemClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Website request · Ada · TAN-7, 6 Nov/ })).toHaveTextContent('Web · Ada · TAN-7');
    expect(screen.getByRole('button', { name: /^Ben · TAN-8/ })).toHaveTextContent(/^Ben · TAN-8$/);
  });
  it('drag-selects empty cells into a range', () => {
    const onEmptySelect = vi.fn();
    render(<CalendarGrid data={data} onEmptySelect={onEmptySelect} onItemClick={vi.fn()} />);
    fireEvent.mouseDown(screen.getByTestId('cell-u1-2026-11-06'));
    fireEvent.mouseEnter(screen.getByTestId('cell-u1-2026-11-08'));
    fireEvent.mouseUp(screen.getByTestId('cell-u1-2026-11-08'));
    expect(onEmptySelect).toHaveBeenCalledWith('u1', '2026-11-06', '2026-11-09');
  });
});

describe('narrow (mobile) window', () => {
  it('includes a stay departing today when the window starts the day before', () => {
    // CalendarPage fetches [day-1, day+2) in narrow mode; the checkout-today item must survive
    // the API overlap filter (start < to && end > from), which layoutBars mirrors.
    const departing = { kind: 'block' as const, id: 'st', unitId: 'u1', start: '2026-10-30', end: '2026-11-01', source: 'manual' as const, reason: 'maintenance', label: 'Stay' };
    const bars = layoutBars([departing], '2026-10-31', 3);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.col).toBe(0);
    expect(bars[0]!.span).toBe(1);
  });
});
