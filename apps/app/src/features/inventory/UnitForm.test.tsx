import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Unit } from '@boogbe/shared';
import { UnitForm } from './UnitForm';

const unit: Unit = {
  id: 'u1',
  propertyId: 'p1',
  name: 'Kairo',
  bedrooms: 2,
  maxGuests: 4,
  nightlyRateKobo: 20_000_000,
  defaultAssigneeMemberId: null,
  checkInInstructions: null,
  sortOrder: 0,
  active: true,
  publicListed: false,
  feeOverride: false,
  feeType: 'none',
  feeBps: 0,
  feeFixedMonthlyKobo: 0,
  ownerFollowsProperty: true,
  currentOwner: null,
  currentOwnerSource: 'operator',
};

function serve() {
  const bodies: Record<string, unknown>[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    return new Response(JSON.stringify({ ...unit, ...body }));
  });
  return bodies;
}

describe('UnitForm — Show on website', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists an existing unit on the website', async () => {
    const bodies = serve();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<UnitForm propertyId="p1" initial={unit} onSaved={onSaved} />);
    const box = screen.getByLabelText('Show on website');
    expect(box).not.toBeChecked();
    expect(
      screen.getByText('Guests can see availability and request this apartment on your website.'),
    ).toBeInTheDocument();
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Save unit' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(bodies[0]).toMatchObject({ publicListed: true });
  });

  it('a new unit starts hidden from the website', async () => {
    const bodies = serve();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<UnitForm propertyId="p1" onSaved={onSaved} />);
    await user.type(screen.getByLabelText('Unit name'), 'Zuri');
    await user.type(screen.getByLabelText('Nightly rate'), '50000');
    await user.click(screen.getByRole('button', { name: 'Save unit' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(bodies[0]).toMatchObject({ publicListed: false });
  });
});
