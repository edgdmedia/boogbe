import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarResponse } from '@boogbe/shared';
import { CalendarGrid } from './CalendarGrid';

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
  it('drag-selects empty cells into a range', () => {
    const onEmptySelect = vi.fn();
    render(<CalendarGrid data={data} onEmptySelect={onEmptySelect} onItemClick={vi.fn()} />);
    fireEvent.mouseDown(screen.getByTestId('cell-u1-2026-11-06'));
    fireEvent.mouseEnter(screen.getByTestId('cell-u1-2026-11-08'));
    fireEvent.mouseUp(screen.getByTestId('cell-u1-2026-11-08'));
    expect(onEmptySelect).toHaveBeenCalledWith('u1', '2026-11-06', '2026-11-09');
  });
});
