import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarResponse } from '@boogbe/shared';
import { DayList } from './DayList';

const data: CalendarResponse = {
  from: '2026-10-31',
  to: '2026-11-02',
  today: '2026-11-01',
  properties: [
    { id: 'p', name: 'The Rock', units: [{ id: 'u1', name: 'Kairo', bedrooms: 2, maxGuests: 4, nightlyRateKobo: 20_000_000 }] },
  ],
  items: [
    { kind: 'booking', id: 'b1', unitId: 'u1', start: '2026-10-30', end: '2026-11-01', status: 'checked_in', source: 'phone', ref: 'TAN-1', guestName: 'Ada', balanceKobo: null, hasConflict: false },
    { kind: 'booking', id: 'b2', unitId: 'u1', start: '2026-11-01', end: '2026-11-03', status: 'confirmed', source: 'phone', ref: 'TAN-2', guestName: 'Ben', balanceKobo: null, hasConflict: false },
  ],
};

describe('DayList [CAL-05]', () => {
  it('shows departures, arrivals and free units for the selected day', () => {
    render(<DayList data={data} day="2026-11-01" onItemClick={vi.fn()} onNew={vi.fn()} />);
    expect(screen.getByText('Leaving (1)')).toBeInTheDocument();
    expect(screen.getByText('Arriving (1)')).toBeInTheDocument();
    const arriving = screen.getByText('Arriving (1)').nextElementSibling;
    expect(arriving?.textContent).toContain('Ben');
  });
});
