import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SignIn } from './SignIn';

vi.mock('../../lib/auth-client', () => ({
  authClient: {
    signIn: { email: vi.fn().mockResolvedValue({ error: { status: 401, message: 'Invalid email or password' } }) },
  },
}));

describe('SignIn', () => {
  it('shows validation then server errors', async () => {
    render(
      <MemoryRouter>
        <SignIn />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/enter a valid email/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.ng');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });
});
