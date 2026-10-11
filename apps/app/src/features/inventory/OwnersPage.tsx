import { useState, type ReactNode } from 'react';
import type { Owner } from '@boogbe/shared';
import { Badge, Button, Dialog, EmptyState, Spinner, Table } from '@boogbe/ui';
import { api } from '../../lib/api';
import { useOwners } from './hooks';
import { OwnerForm } from './OwnerForm';

const PORTAL: Record<Owner['portalStatus'], ReactNode> = {
  none: <Badge>No portal</Badge>,
  invited: <Badge tone="warning">Invited</Badge>,
  active: <Badge tone="success">Portal active</Badge>,
};

export function OwnersPage() {
  const { data, mutate } = useOwners();
  const [edit, setEdit] = useState<Owner | 'new' | null>(null);
  const [msg, setMsg] = useState<string>();
  if (!data) return <Spinner />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Property owners</h1>
        <Button onClick={() => setEdit('new')}>Add owner</Button>
      </div>
      {msg && (
        <p role="status" className="text-sm">
          {msg}
        </p>
      )}
      {data.items.length === 0 ? (
        <EmptyState title="No owners yet" body="Add the people whose properties you manage." />
      ) : (
        <Table
          rows={data.items}
          onRowClick={(o) => setEdit(o)}
          columns={[
            { key: 'name', header: 'Name', cell: (o) => o.name },
            { key: 'contact', header: 'Contact', cell: (o) => o.phone ?? o.email ?? '—' },
            { key: 'bank', header: 'Bank', cell: (o) => (o.bankName ? `${o.bankName} · ${o.accountNumber ?? ''}` : '—') },
            { key: 'portal', header: 'Portal', cell: (o) => PORTAL[o.portalStatus] },
            {
              key: 'act',
              header: '',
              cell: (o) =>
                o.portalStatus === 'none' &&
                o.email && (
                  <Button
                    variant="ghost"
                    onClick={async (e) => {
                      e.stopPropagation();
                      await api(`/v1/owners/${o.id}/invite`, { method: 'POST' });
                      setMsg(`Invitation sent to ${o.email}`);
                      await mutate();
                    }}
                  >
                    Invite
                  </Button>
                ),
            },
          ]}
        />
      )}
      <Dialog open={edit !== null} onClose={() => setEdit(null)} title={edit === 'new' ? 'Add owner' : 'Edit owner'}>
        {edit !== null && (
          <OwnerForm
            initial={edit === 'new' ? undefined : edit}
            onSaved={async () => {
              setEdit(null);
              await mutate();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
