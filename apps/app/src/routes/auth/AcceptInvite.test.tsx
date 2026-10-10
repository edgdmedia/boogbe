import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AcceptInvite } from './AcceptInvite';

vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  api: vi.fn().mockResolvedValue({
    id: 'i1',
    email: 'a@t.ng',
    orgName: 'Tanuhomes',
    role: 'housekeeper',
    status: 'pending',
    expired: false,
    userExists: false,
  }),
}));
vi.mock('../../lib/auth-client', () => ({ authClient: { useSession: () => ({ data: null, isPending: false }) } }));

describe('AcceptInvite', () => {
  it('shows org, role and a create-account form for new users', async () => {
    render(
      <MemoryRouter initialEntries={['/auth/accept-invite/i1']}>
        <Routes>
          <Route path="/auth/accept-invite/:id" element={<AcceptInvite />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/join tanuhomes as housekeeper/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('a@t.ng')).toBeDisabled();
  });
});
