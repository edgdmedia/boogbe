import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GuestForm } from './GuestForm';

const { mockApi } = vi.hoisted(() => ({ mockApi: vi.fn(async () => ({ items: [] })) }));

vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  api: mockApi,
}));

describe('GuestForm duplicate check [GST-03]', () => {
  it('shows nothing and stays interactive when the match lookup fails (half-typed input, 400)', async () => {
    mockApi.mockRejectedValueOnce(new Error('400 Bad Request'));
    render(<GuestForm onSaved={vi.fn()} onMatch={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/^phone/i), '0803123456');
    await userEvent.tab();
    await userEvent.type(screen.getByLabelText(/email/i), 'ada@'); // half-typed
    await userEvent.tab();
    expect(screen.queryByText(/This looks like/)).toBeNull();
    expect(screen.getByLabelText(/full name/i)).toBeEnabled();
  });
});
