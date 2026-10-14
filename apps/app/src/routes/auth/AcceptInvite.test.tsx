import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AcceptInvite } from './AcceptInvite';

const state = vi.hoisted(() => ({
  me: null as null | { email: string },
  invitation: { id: 'i1', email: 'a@t.ng', orgName: 'Tanuhomes', role: 'housekeeper', status: 'pending', expired: false, userExists: false },
}));
const auth = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  setActive: vi.fn(),
}));

// The invitation comes from the mocked `api`; /v1/me always reaches the real `api` (useApi calls it internally) and
// so `fetch`, stubbed per test below.
vi.mock('../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../lib/api')>();
  return {
    ...real,
    api: vi.fn(async (path: string, init?: Parameters<typeof real.api>[1]) =>
      path === '/v1/me' ? real.api(path, init) : state.invitation,
    ),
  };
});
vi.mock('../../lib/auth-client', () => ({
  authClient: {
    organization: { acceptInvitation: auth.acceptInvitation, setActive: auth.setActive },
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
  },
}));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      state.me
        ? new Response(
            JSON.stringify({ user: { id: 'u1', name: 'Ada', email: state.me.email, isPlatformAdmin: false }, activeOrg: null, memberships: [] }),
            { status: 200 },
          )
        : new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in' } }), { status: 401 }),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  state.me = null;
  state.invitation = { ...state.invitation, status: 'pending', userExists: false };
  vi.clearAllMocks();
});

const show = () =>
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MemoryRouter initialEntries={['/auth/accept-invite/i1']}>
        <Routes>
          <Route path="/auth/accept-invite/:id" element={<AcceptInvite />} />
          <Route path="/" element={<p>Home page</p>} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>,
  );

describe('AcceptInvite', () => {
  it('shows org, role and a create-account form for new users', async () => {
    show();
    expect(await screen.findByText(/join tanuhomes as housekeeper/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('a@t.ng')).toBeDisabled();
  });

  it('a signed-in invitee accepts with one click — no password form — and lands in the app', async () => {
    state.me = { email: 'a@t.ng' };
    state.invitation = { ...state.invitation, userExists: true };
    auth.acceptInvitation.mockResolvedValue({ data: { member: { organizationId: 'o1' } } });
    auth.setActive.mockResolvedValue({ data: {} });
    show();
    expect(await screen.findByText(/join tanuhomes as housekeeper/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(auth.acceptInvitation).toHaveBeenCalledWith({ invitationId: 'i1' });
    expect(auth.setActive).toHaveBeenCalledWith({ organizationId: 'o1' });
  });

  it('a signed-in invitee whose invitation is already accepted goes straight into the app', async () => {
    state.me = { email: 'A@t.ng' };
    state.invitation = { ...state.invitation, status: 'accepted', userExists: true };
    show();
    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });

  it('someone else signed in still sees the invitation form for the invitee', async () => {
    state.me = { email: 'other@t.ng' };
    state.invitation = { ...state.invitation, userExists: true };
    show();
    expect(await screen.findByText(/join tanuhomes as housekeeper/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });
});
