import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnlineBooking, originsFor } from './OnlineBooking';

const role = vi.hoisted(() => ({ current: 'admin' }));
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { role: role.current } } }) }));

const settings = (s: Record<string, unknown> = {}) => ({
  org: {
    id: 'o1',
    name: 'Tanu Homes',
    slug: 'tanuhomes',
    timezone: 'Africa/Lagos',
    currency: 'NGN',
    contactEmail: 'hello@tanuhomes.com',
    contactPhone: null,
    whatsappPhone: null,
    address: null,
  },
  settings: {
    checkInTime: '14:00',
    checkOutTime: '12:00',
    holdHours: 24,
    autoConfirmOnPayment: true,
    ownerSeesGuestNames: false,
    receiptPrefix: 'RCP',
    statementPrefix: 'STM',
    bookingPrefix: 'TAN',
    logoUrl: null,
    publicEnabled: false,
    publicHoldMinutes: 120,
    publicOrigins: [],
    publicSiteUrl: null,
    notifyEmails: [],
    ...s,
  },
});

/** The real useApi + api run; only fetch is replaced, answering GET with `current` and recording PATCH bodies. */
function serve(current: ReturnType<typeof settings>, patchStatus = 200) {
  const patches: unknown[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    if (init?.method === 'PATCH') {
      patches.push(JSON.parse(String(init.body)));
      if (patchStatus !== 200)
        return new Response(
          JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'Check the form' } }),
          { status: patchStatus },
        );
    }
    return new Response(JSON.stringify(current));
  });
  return patches;
}
const renderPage = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <OnlineBooking />
    </SWRConfig>,
  );

describe('OnlineBooking', () => {
  afterEach(() => vi.restoreAllMocks());

  it('saves online booking settings', async () => {
    const patches = serve(settings());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByLabelText('Accept booking requests from your website'));
    await user.clear(screen.getByLabelText('Hold requested dates for (minutes)'));
    await user.type(screen.getByLabelText('Hold requested dates for (minutes)'), '90');
    await user.type(screen.getByLabelText('Website address'), 'https://tanuhomes.com');
    await user.type(screen.getByLabelText('Also email new requests to'), 'desk@tanuhomes.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(patches).toEqual([
        {
          publicEnabled: true,
          publicHoldMinutes: 90,
          publicSiteUrl: 'https://tanuhomes.com',
          publicOrigins: ['https://tanuhomes.com', 'https://www.tanuhomes.com'],
          notifyEmails: ['desk@tanuhomes.com'],
        },
      ]),
    );
  });

  it('shows saved values and the booking slug', async () => {
    serve(
      settings({
        publicEnabled: true,
        publicHoldMinutes: 60,
        publicSiteUrl: 'https://www.tanuhomes.com/stay',
        publicOrigins: [
          'https://www.tanuhomes.com',
          'https://tanuhomes.com',
          'https://staging.tanuhomes.com',
        ],
        notifyEmails: ['a@x.ng', 'b@x.ng'],
      }),
    );
    renderPage();
    expect(await screen.findByLabelText('Accept booking requests from your website')).toBeChecked();
    expect(screen.getByLabelText('Hold requested dates for (minutes)')).toHaveValue(60);
    expect(screen.getByLabelText('Website address')).toHaveValue('https://www.tanuhomes.com/stay');
    expect(screen.getByLabelText('Also email new requests to')).toHaveValue('a@x.ng, b@x.ng');
    // Origins beyond the website and its www twin (a staging site) stay editable and are kept on save.
    expect(screen.getByLabelText('Other sites that can show the booking form')).toHaveValue(
      'https://staging.tanuhomes.com',
    );
    expect(screen.getByText('tanuhomes')).toBeInTheDocument();
  });

  it('keeps extra sites and clears the website', async () => {
    const patches = serve(
      settings({
        publicSiteUrl: 'https://tanuhomes.com',
        publicOrigins: ['https://tanuhomes.com', 'https://www.tanuhomes.com'],
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.clear(await screen.findByLabelText('Website address'));
    await user.type(
      screen.getByLabelText('Other sites that can show the booking form'),
      'https://staging.tanuhomes.com/x',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({
      publicSiteUrl: null,
      publicOrigins: ['https://staging.tanuhomes.com'],
    });
  });

  it('rejects a bad address or email without saving', async () => {
    const patches = serve(settings());
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText('Website address'), 'http://tanuhomes.com');
    await user.type(screen.getByLabelText('Also email new requests to'), 'desk@, ok@x.ng');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Use your website address, starting with https://')).toBeInTheDocument();
    expect(screen.getByText('Check these addresses: desk@')).toBeInTheDocument();
    expect(patches).toEqual([]);
  });

  it('shows the server error when saving fails', async () => {
    serve(settings(), 400);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the form');
  });
});

describe('OnlineBooking edge cases', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    role.current = 'admin';
  });

  it('sends a lower-case https:// address and lower-cased, de-duplicated emails', async () => {
    const patches = serve(settings());
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText('Website address'), 'HTTPS://TanuHomes.com/stay');
    await user.type(
      screen.getByLabelText('Also email new requests to'),
      'A@x.ng, a@x.ng, b@x.ng, c@x.ng, d@x.ng, e@x.ng',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({
      publicSiteUrl: 'https://tanuhomes.com/stay',
      publicOrigins: ['https://tanuhomes.com', 'https://www.tanuhomes.com'],
      notifyEmails: ['a@x.ng', 'b@x.ng', 'c@x.ng', 'd@x.ng', 'e@x.ng'],
    });
  });

  it('a background refresh does not wipe unsaved edits', async () => {
    let current = settings();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(current)));
    const user = userEvent.setup();
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <OnlineBooking />
        <RefreshButton />
      </SWRConfig>,
    );
    await user.type(await screen.findByLabelText('Website address'), 'https://tanuhomes.com');
    current = settings({ publicHoldMinutes: 30 });
    await user.click(screen.getByRole('button', { name: 'refresh' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByLabelText('Website address')).toHaveValue('https://tanuhomes.com');
  });

  it('non-admins see a notice instead of the form', async () => {
    role.current = 'frontdesk';
    serve(settings());
    renderPage();
    expect(await screen.findByText('Only admins can change online booking.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});

function RefreshButton() {
  const { mutate } = useSWRConfig();
  return (
    <button type="button" onClick={() => mutate('/v1/org/settings')}>
      refresh
    </button>
  );
}

describe('originsFor', () => {
  it('adds the www twin, or the bare twin when www was typed', () => {
    expect(originsFor('https://tanuhomes.com/short-lets')).toEqual([
      'https://tanuhomes.com',
      'https://www.tanuhomes.com',
    ]);
    expect(originsFor('https://www.tanuhomes.com')).toEqual([
      'https://www.tanuhomes.com',
      'https://tanuhomes.com',
    ]);
    expect(originsFor('https://book.tanuhomes.com')).toEqual([
      'https://book.tanuhomes.com',
      'https://www.book.tanuhomes.com',
    ]);
    expect(originsFor('')).toEqual([]);
  });
});
