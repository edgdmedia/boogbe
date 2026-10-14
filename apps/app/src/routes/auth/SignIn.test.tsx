import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '../../components/shell/RequireAuth';
import { SignIn } from './SignIn';

const server = vi.hoisted(() => ({ signedIn: false }));
const signInEmail = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth-client', () => ({ authClient: { signIn: { email: signInEmail } } }));

const me = {
  user: { id: 'u1', name: 'Ada', email: 'a@b.ng', isPlatformAdmin: false },
  activeOrg: null,
  memberships: [{ orgId: 'o1', orgName: 'Tanuhomes', role: 'admin' }],
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  // Signed out unless a test says otherwise; the sign-in page asks /v1/me who is there.
  vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Please sign in' } })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  server.signedIn = false;
});

const fill = async () => {
  await userEvent.type(await screen.findByLabelText(/email/i), 'a@b.ng');
  await userEvent.type(screen.getByLabelText(/password/i), 'correct-horse');
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
};

describe('SignIn', () => {
  it('shows validation then server errors', async () => {
    signInEmail.mockResolvedValue({ error: { status: 401, message: 'Invalid email or password' } });
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MemoryRouter>
          <SignIn />
        </MemoryRouter>
      </SWRConfig>,
    );
    await userEvent.click(await screen.findByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/enter a valid email/i)).toBeInTheDocument();
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('lands on the protected page after signing in through the form, without a reload [T-M2-13]', async () => {
    // Visiting `/` first caches a 401 for /v1/me — the state a real first visit is in.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).endsWith('/v1/me')
          ? server.signedIn
            ? json(200, me)
            : json(401, { error: { code: 'UNAUTHENTICATED', message: 'Please sign in' } })
          : json(404, {}),
      ),
    );
    signInEmail.mockImplementation(async () => {
      server.signedIn = true;
      return { data: { user: me.user } };
    });
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/auth/sign-in" element={<SignIn />} />
            <Route element={<RequireAuth />}>
              <Route path="/" element={<p>Signed-in home</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </SWRConfig>,
    );
    expect(await screen.findByRole('heading', { name: /sign in to boogbe/i })).toBeInTheDocument();
    await fill();
    expect(await screen.findByText('Signed-in home')).toBeInTheDocument();
  });

  it.each([
    ['/auth/sign-in?next=%2Fbookings', 'Bookings page'],
    ['/auth/sign-in?next=%2F%2Fevil.com', 'Home page'],
    ['/auth/sign-in', 'Home page'],
  ])('a signed-in user opening %s is sent on to %s, not shown the form', async (entry, landing) => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, me)));
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/auth/sign-in" element={<SignIn />} />
            <Route path="/" element={<p>Home page</p>} />
            <Route path="/bookings" element={<p>Bookings page</p>} />
          </Routes>
        </MemoryRouter>
      </SWRConfig>,
    );
    expect(await screen.findByText(landing)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('sends a deep link through after signing in, but never off-site', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => (server.signedIn ? json(200, me) : json(401, { error: { code: 'UNAUTHENTICATED' } }))));
    signInEmail.mockImplementation(async () => {
      server.signedIn = true;
      return { data: { user: me.user } };
    });
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MemoryRouter initialEntries={['/auth/sign-in?next=%2F%2Fevil.com']}>
          <Routes>
            <Route path="/auth/sign-in" element={<SignIn />} />
            <Route path="/" element={<p>Home page</p>} />
            <Route path="*" element={<p>Somewhere else</p>} />
          </Routes>
        </MemoryRouter>
      </SWRConfig>,
    );
    await fill();
    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });

  it('says so when the session cannot be loaded after signing in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    signInEmail.mockResolvedValue({ data: { user: me.user } });
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MemoryRouter>
          <SignIn />
        </MemoryRouter>
      </SWRConfig>,
    );
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('Network problem');
  });
});
