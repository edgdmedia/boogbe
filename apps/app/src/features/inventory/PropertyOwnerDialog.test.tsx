import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PropertyOwnerForm } from './PropertyOwnerDialog';

const apiPost = vi.fn(async (_path: string, _init?: unknown) => ({}));

vi.mock('../../lib/api', () => ({
  api: (path: string, init?: unknown) => apiPost(path, init),
  ApiError: class extends Error {},
  useApi: () => ({ data: undefined, mutate: vi.fn() }),
}));
vi.mock('./hooks', () => ({
  useOwners: () => ({ data: { items: [{ id: 'o1', name: 'Mrs Adebayo' }] }, mutate: vi.fn() }),
}));

describe('PropertyOwnerForm [INV-01 INV-03]', () => {
  it('posts the chosen owner with an effective date', async () => {
    const onSaved = vi.fn();
    render(<PropertyOwnerForm propertyId="p1" currentName={null} onSaved={onSaved} />);
    await userEvent.selectOptions(screen.getByLabelText('Default owner'), 'o1');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-12-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/v1/properties/p1/owner', {
        method: 'POST',
        body: { defaultOwnerId: 'o1', effectiveFrom: '2026-12-01' },
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it('operator default sends defaultOwnerId null', async () => {
    apiPost.mockClear();
    render(<PropertyOwnerForm propertyId="p1" currentName="Some Owner" onSaved={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText('Default owner'), '__operator__');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/v1/properties/p1/owner', {
        method: 'POST',
        body: expect.objectContaining({ defaultOwnerId: null }),
      }),
    );
  });

  it('refuses a missing date', async () => {
    apiPost.mockClear();
    render(<PropertyOwnerForm propertyId="p1" currentName={null} onSaved={vi.fn()} />);
    const from = screen.getByLabelText('From');
    fireEvent.change(from, { target: { value: '' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(apiPost).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
