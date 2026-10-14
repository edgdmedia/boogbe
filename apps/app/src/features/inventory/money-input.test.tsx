import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MoneyInput, PercentInput } from './money-input';

function Harness({ onValue }: { onValue: (v: number) => void }) {
  const [v, setV] = useState(0);
  return <MoneyInput aria-label="Rate" value={v} onChange={(k) => { setV(k); onValue(k); }} />;
}

describe('MoneyInput', () => {
  it('turns typed naira into kobo and shows grouping on blur', async () => {
    let last = -1;
    render(<Harness onValue={(v) => (last = v)} />);
    const input = screen.getByLabelText('Rate');
    await userEvent.type(input, '200000.5');
    expect(last).toBe(20_000_050);
    await userEvent.tab();
    expect(input).toHaveValue('200,000.50');
  });
  it('ignores letters', async () => {
    let last = -1;
    render(<Harness onValue={(v) => (last = v)} />);
    await userEvent.type(screen.getByLabelText('Rate'), 'abc');
    expect(last).toBe(0);
  });
});

describe('PercentInput', () => {
  it('emits basis points', async () => {
    let last = -1;
    function H() {
      const [v, setV] = useState(0);
      return <PercentInput aria-label="Fee" valueBps={v} onChange={(b) => { setV(b); last = b; }} />;
    }
    render(<H />);
    await userEvent.type(screen.getByLabelText('Fee'), '12.5');
    expect(last).toBe(1250);
  });
});
