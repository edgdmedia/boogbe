import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebsiteRequestsCard } from './WebsiteRequestsCard';

const summary = (s: Record<string, unknown>) => ({
  id: 'b1',
  ref: 'TAN-2611-0001',
  unitName: 'Kairo',
  propertyName: 'The Rock',
  guestName: 'Ada Obi',
  checkIn: '2026-11-20',
  checkOut: '2026-11-22',
  nights: 2,
  status: 'tentative',
  source: 'website',
  finalTotalKobo: 40_000_000,
  balanceKobo: 40_000_000,
  holdUntil: '2026-11-01T11:00:00Z',
  ...s,
});
function serve(body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(body)));
}
const renderCard = () =>
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MemoryRouter>
        <WebsiteRequestsCard />
      </MemoryRouter>
    </SWRConfig>,
  );

describe('WebsiteRequestsCard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists open website requests soonest-expiry first', async () => {
    const f = serve({
      items: [
        summary({ id: 'b2', ref: 'TAN-2611-0002', guestName: 'Ben', holdUntil: '2026-11-01T12:00:00Z' }),
        summary({ id: 'b1', ref: 'TAN-2611-0001', guestName: 'Ada Obi', holdUntil: '2026-11-01T11:00:00Z' }),
      ],
      nextCursor: null,
    });
    renderCard();
    expect(await screen.findByRole('heading', { name: 'New website requests' })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /TAN-/ });
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/bookings/b1', '/bookings/b2']);
    expect(links[0]).toHaveTextContent('TAN-2611-0001');
    expect(screen.getByText(/Ada Obi/)).toBeInTheDocument();
    expect(screen.getAllByText('₦400,000')).toHaveLength(2);
    const url = String(f.mock.calls[0]![0]);
    expect(url).toContain('source=website');
    expect(url).toContain('status=tentative');
  });

  it('renders nothing with no requests', async () => {
    const f = serve({ items: [], nextCursor: null });
    const { container } = renderCard();
    await waitFor(() => expect(f).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
