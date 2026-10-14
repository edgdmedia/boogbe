import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhoneInput } from './PhoneInput';

describe('PhoneInput', () => {
  it('normalises local numbers and reports E.164', async () => {
    const onChange = vi.fn();
    render(<PhoneInput aria-label="Phone" value={null} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Phone'), '08107548559');
    expect(onChange).toHaveBeenLastCalledWith('+2348107548559', '08107548559');
    expect(screen.getByText('+234 810 754 8559')).toBeInTheDocument();
  });
  it('reports null for incomplete numbers', async () => {
    const onChange = vi.fn();
    render(<PhoneInput aria-label="Phone" value={null} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Phone'), '0810');
    expect(onChange).toHaveBeenLastCalledWith(null, '0810');
  });
});
