import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge, Dialog, PageHeader, StatTile, Table, Textarea, Field, CardHeader, Input } from '@boogbe/ui';

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

  // Review fixes (#90): these pin classes/attributes jsdom cannot check by behaviour.
  it('dialog backdrop stays dark in dark mode (not the light ink colour)', () => {
    render(
      <Dialog open onClose={() => {}} title="Edit">
        <p>a</p>
      </Dialog>,
    );
    const cls = screen.getByRole('dialog').className;
    expect(cls).toContain('backdrop:bg-black/40');
    expect(cls).not.toContain('backdrop:bg-ink');
  });

  it('fields keep a forced-colors-safe focus outline', () => {
    render(<Input aria-label="Name" />);
    const cls = screen.getByRole('textbox', { name: 'Name' }).className;
    expect(cls).toContain('focus:outline-hidden');
    expect(cls).not.toContain('focus:outline-none');
  });

  it('table keeps explicit table roles when the phone layout restyles it as blocks', () => {
    const { container } = render(<Table rows={[{ id: 'r1' }]} columns={[{ key: 'a', header: 'A', cell: () => 'x' }]} />);
    expect(container.querySelector('table')).toHaveAttribute('role', 'table');
    expect(container.querySelectorAll('[role="rowgroup"]')).toHaveLength(2);
    expect(container.querySelectorAll('tr[role="row"]')).toHaveLength(2);
    expect(container.querySelector('th')).toHaveAttribute('role', 'columnheader');
    expect(container.querySelector('td')).toHaveAttribute('role', 'cell');
  });

  it('a width passed by the page wins over the full-width default (w-40 date pickers in headers)', () => {
    render(
      <>
        <Input aria-label="Day" className="w-40" />
        <Input aria-label="Name" />
      </>,
    );
    const day = screen.getByRole('textbox', { name: 'Day' }).className.split(' ');
    expect(day).toContain('w-40');
    expect(day).not.toContain('w-full');
    expect(screen.getByRole('textbox', { name: 'Name' }).className.split(' ')).toContain('w-full');
  });
});
