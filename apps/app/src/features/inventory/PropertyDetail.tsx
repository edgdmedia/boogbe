import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { can, type Unit } from '@boogbe/shared';
import { Badge, Button, Card, Dialog, EmptyState, Spinner } from '@boogbe/ui';
import { api } from '../../lib/api';
import { formatNaira } from '../../lib/format';
import { useMe } from '../../lib/use-me';
import { useProperty, useUnits } from './hooks';
import { feeSummary } from './money-input';
import { PropertyForm } from './PropertyForm';
import { UnitFees } from './UnitFees';
import { UnitForm } from './UnitForm';
import { UnitOwnerForm } from './UnitOwnerDialog';

const SOURCE = { unit: '', property: ' (from property)', operator: '' } as const;

export function PropertyDetail() {
  const { id = '' } = useParams();
  const { me } = useMe();
  const { data: p, mutate: mutateP } = useProperty(id);
  const { data: units, mutate: mutateU } = useUnits(id);
  const [dialog, setDialog] = useState<
    null | { kind: 'edit' } | { kind: 'unit'; unit?: Unit } | { kind: 'owner'; unit: Unit } | { kind: 'fees'; unit: Unit }
  >(null);
  const role = me?.activeOrg?.role;
  const canWrite = !!role && can(role, 'inventory.write');
  const canOwners = !!role && can(role, 'owners.write');
  if (!p || !units) return <Spinner />;
  const close = () => setDialog(null);
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{p.name}</h1>
          <p className="text-sm text-ink-muted">{p.address}</p>
          <p className="mt-1 text-sm">{feeSummary(p, formatNaira)}</p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDialog({ kind: 'edit' })}>
              Edit
            </Button>
            <Button onClick={() => setDialog({ kind: 'unit' })}>Add unit</Button>
          </div>
        )}
      </Card>
      {units.items.length === 0 ? (
        <EmptyState title="No units yet" body="Add the apartments guests can book." />
      ) : (
        units.items.map((u) => (
          <Card key={u.id} className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">
                {u.name} {!u.active && <Badge>Archived</Badge>}
              </p>
              <p className="text-sm text-ink-muted">
                {u.bedrooms} bed · up to {u.maxGuests} guests · {formatNaira(u.nightlyRateKobo)} / night
              </p>
              <p className="text-sm">{u.currentOwner ? `${u.currentOwner.name}${SOURCE[u.currentOwnerSource]}` : 'Operator-owned'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canWrite && (
                <Button variant="ghost" onClick={() => setDialog({ kind: 'unit', unit: u })}>
                  Edit
                </Button>
              )}
              <Button variant="ghost" onClick={() => setDialog({ kind: 'fees', unit: u })}>
                Fees
              </Button>
              {canOwners && (
                <Button variant="ghost" onClick={() => setDialog({ kind: 'owner', unit: u })}>
                  Owner
                </Button>
              )}
              {canWrite && (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await api(`/v1/units/${u.id}/${u.active ? 'archive' : 'unarchive'}`, { method: 'POST' });
                    await mutateU();
                  }}
                >
                  {u.active ? 'Archive' : 'Restore'}
                </Button>
              )}
            </div>
          </Card>
        ))
      )}
      <Dialog open={dialog?.kind === 'edit'} onClose={close} title="Edit property">
        <PropertyForm
          initial={p}
          onSaved={async () => {
            close();
            await mutateP();
          }}
        />
      </Dialog>
      <Dialog open={dialog?.kind === 'unit'} onClose={close} title={dialog?.kind === 'unit' && dialog.unit ? 'Edit unit' : 'Add unit'}>
        {dialog?.kind === 'unit' && (
          <UnitForm
            propertyId={p.id}
            initial={dialog.unit}
            onSaved={async () => {
              close();
              await mutateU();
              await mutateP();
            }}
          />
        )}
      </Dialog>
      <Dialog open={dialog?.kind === 'owner'} onClose={close} title="Unit owner">
        {dialog?.kind === 'owner' && (
          <UnitOwnerForm
            unit={dialog.unit}
            onSaved={async () => {
              close();
              await mutateU();
            }}
          />
        )}
      </Dialog>
      <Dialog open={dialog?.kind === 'fees'} onClose={close} title="Fees">
        {dialog?.kind === 'fees' && <UnitFees unitId={dialog.unit.id} canWrite={canWrite} />}
      </Dialog>
    </div>
  );
}
