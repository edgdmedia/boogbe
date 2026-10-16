import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HoldCountdown } from './HoldCountdown';

describe('HoldCountdown', () => {
  afterEach(() => vi.useRealTimers());

  it('shows minutes left and turns urgent under 15 minutes', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-11-01T10:00:00Z'));
    const { rerender } = render(<HoldCountdown holdUntil="2026-11-01T11:30:00Z" />);
    expect(screen.getByText('Held 1 h 30 min')).toBeInTheDocument();
    expect(screen.getByText('Held 1 h 30 min')).toHaveAttribute('data-urgent', 'false');
    rerender(<HoldCountdown holdUntil="2026-11-01T10:10:00Z" />);
    expect(screen.getByText('Held 10 min')).toHaveAttribute('data-urgent', 'true');
    rerender(<HoldCountdown holdUntil="2026-11-01T09:59:00Z" />);
    expect(screen.getByText('Hold expired')).toBeInTheDocument();
  });

  it('counts down on its own and shows whole hours without minutes', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-11-01T10:00:00Z'));
    render(<HoldCountdown holdUntil="2026-11-01T12:00:00Z" />);
    expect(screen.getByText('Held 2 h')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(30 * 60_000));
    expect(screen.getByText('Held 1 h 30 min')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(89 * 60_000 + 30_000));
    expect(screen.getByText('Held 1 min')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(30_000));
    expect(screen.getByText('Hold expired')).toBeInTheDocument();
  });
});
