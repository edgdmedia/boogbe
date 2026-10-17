import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge, Dialog, PageHeader, StatTile, Table, Textarea, Field, CardHeader } from '@boogbe/ui';

describe('ui kit', () => {
  it('two open dialogs each get their own accessible name', () => {
    render(
      <>
        <Dialog open onClose={() => {}} title="Edit TAN-1">
          <p>a</p>
        </Dialog>
        <Dialog open onClose={() => {}} title="Cancel booking">
          <p>b</p>
        </Dialog>
      </>,
    );
    expect(screen.getByRole('dialog', { name: 'Edit TAN-1' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Cancel booking' })).toBeInTheDocument();
  });

  it('table keeps one row per item and labels each cell for the phone card layout', () => {
    render(
      <Table
        rows={[{ id: 'b1', guest: 'Tunde Bakare' }]}
        columns={[
          { key: 'g', header: 'Guest', cell: (r) => r.guest },
          { key: 'n', header: 'Notes', cell: () => 'x', hideOnMobile: true },
        ]}
      />,
    );
    expect(screen.getAllByRole('row')).toHaveLength(2); // header + one body row, no duplicate card list
    expect(screen.getByText('Tunde Bakare').closest('td')).toHaveAttribute('data-label', 'Guest');
    expect(screen.getAllByText('Tunde Bakare')).toHaveLength(1);
  });

  it('page header renders one h1 with meta and actions', () => {
    render(
      <PageHeader title="Bookings" eyebrow="Front desk" meta={<Badge tone="success">Confirmed</Badge>} actions={<button>New booking</button>} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Bookings' })).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New booking' })).toBeInTheDocument();
  });

  it('status badge text stays the accessible content; the dot is decorative', () => {
    render(<Badge tone="danger">Cancelled</Badge>);
    const badge = screen.getByText('Cancelled');
    expect(badge.textContent).toBe('Cancelled');
    expect(badge.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('stat tile shows label and value; card header is an h2', () => {
    render(
      <>
        <StatTile label="Received" value="₦262,500" sub="3 payments" />
        <CardHeader title="History" eyebrow="Booking" />
      </>,
    );
    expect(screen.getByText('Received')).toBeInTheDocument();
    expect(screen.getByText('₦262,500')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'History' })).toBeInTheDocument();
  });

  it('textarea works inside Field (label association)', () => {
    render(
      <Field label="Notes">
        <Textarea />
      </Field>,
    );
    expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA');
    expect(within(document.body).getByRole('textbox', { name: 'Notes' })).toBeInTheDocument();
  });
});
