import { Building2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { can } from '@boogbe/shared';
import { Badge, Button, Dialog, EmptyState, PageHeader, Spinner, Table } from '@boogbe/ui';
import { formatNaira } from '../../lib/format';
import { useMe } from '../../lib/use-me';
import { useProperties } from './hooks';
import { PropertyForm } from './PropertyForm';
import { feeSummary } from './money-input';

export function PropertiesPage() {
  const { data, mutate } = useProperties(true);
  const nav = useNavigate();
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  const canWrite = !!me?.activeOrg && can(me.activeOrg.role, 'inventory.write');
  if (!data) return <Spinner />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Properties" actions={canWrite && <Button onClick={() => setOpen(true)}>Add property</Button>} />
      {data.items.length === 0 ? (
        <EmptyState icon={<Building2 />} title="No properties yet" body="Add a building or address, then its units." />
      ) : (
        <Table
          rows={data.items}
          onRowClick={(p) => nav(`/settings/properties/${p.id}`)}
          columns={[
            { key: 'name', header: 'Property', cell: (p) => <span className="font-medium">{p.name}</span> },
            { key: 'units', header: 'Units', cell: (p) => p.unitCount },
            { key: 'owner', header: 'Default owner', cell: (p) => p.defaultOwnerName ?? 'Operator' },
            { key: 'fee', header: 'Management fee', cell: (p) => feeSummary(p, formatNaira) },
            { key: 'status', header: '', cell: (p) => !p.active && <Badge>Archived</Badge> },
          ]}
        />
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Add property">
        <PropertyForm
          onSaved={async (p) => {
            setOpen(false);
            await mutate();
            nav(`/settings/properties/${p.id}`);
          }}
        />
      </Dialog>
    </div>
  );
}
