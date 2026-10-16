import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChooseOperator } from './ChooseOperator';

const setActive = vi.hoisted(() => vi.fn());
vi.mock('../lib/auth-client', () => ({ authClient: { organization: { setActive } } }));

const user = { id: 'u1', name: 'Ada', email: 'a@b.ng', isPlatformAdmin: true };
const tanu = { orgId: 'o1', orgName: 'Tanuhomes', role: 'admin' as const };
const other = { orgId: 'o2', orgName: 'Other', role: 'frontdesk' as const };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const assign = vi.fn();

beforeEach(() => {
  vi.stubGlobal('location', { ...window.location, assign });
});
afterEach(() => {
  vi.unstubAllGlobals();
  setActive.mockReset();
  assign.mockReset();
});

const renderAt = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={['/choose-operator']}>
        <Routes>
          <Route path="/choose-operator" element={<ChooseOperator />} />
          <Route path="/" element={<p>Landing</p>} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>,
  );

describe('ChooseOperator', () => {
  it('opens the only operator straight away, without a chooser or a page reload', async () => {
    let active = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ user, activeOrg: active ? { id: 'o1', name: 'Tanuhomes', slug: 't', role: 'admin', timezone: 'Africa/Lagos', currency: 'NGN' } : null, memberships: [tanu] })),
    );
    setActive.mockImplementation(async () => {
      active = true;
      return { data: {} };
    });
    renderAt();
    expect(await screen.findByText('Landing')).toBeInTheDocument();
    expect(setActive).toHaveBeenCalledTimes(1);
    expect(setActive).toHaveBeenCalledWith({ organizationId: 'o1' });
    expect(screen.queryByText(/choose an operator/i)).not.toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('lets a member of several operators choose, then goes in without a page reload', async () => {
    let active = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ user, activeOrg: active ? { id: 'o2', name: 'Other', slug: 'o', role: 'frontdesk', timezone: 'Africa/Lagos', currency: 'NGN' } : null, memberships: [tanu, other] })),
    );
    setActive.mockImplementation(async () => {
      active = true;
      return { data: {} };
    });
    renderAt();
    expect(await screen.findByRole('heading', { name: /choose an operator/i })).toBeInTheDocument();
    expect(setActive).not.toHaveBeenCalled();
    await userEvent.click(screen.getAllByRole('button', { name: /open/i })[1]!);
    expect(await screen.findByText('Landing')).toBeInTheDocument();
    expect(setActive).toHaveBeenCalledWith({ organizationId: 'o2' });
    expect(assign).not.toHaveBeenCalled();
  });

  it('shows an error instead of looping when the operator cannot be opened', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ user, activeOrg: null, memberships: [tanu] })));
    setActive.mockResolvedValue({ data: {} });
    renderAt();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not open/i);
    expect(setActive).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Landing')).not.toBeInTheDocument();
  });
});
