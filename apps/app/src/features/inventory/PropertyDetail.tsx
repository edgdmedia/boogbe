import { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { can, type Unit } from '@boogbe/shared';
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, PageHeader, Spinner } from '@boogbe/ui';
import { api } from '../../lib/api';
import { formatNaira } from '../../lib/format';
import { useMe } from '../../lib/use-me';
import { useProperty, useUnits } from './hooks';
import { feeSummary } from './money-input';
import { PropertyForm } from './PropertyForm';
import { PropertyOwnerForm } from './PropertyOwnerDialog';
import { UnitFees } from './UnitFees';
import { CalendarSyncPanel } from '../ical/CalendarSyncPanel';
import { UnitForm } from './UnitForm';
import { UnitOwnerForm } from './UnitOwnerDialog';

const SOURCE = { unit: '', property: ' (from property)', operator: '' } as const;

export function PropertyDetail() {
  const { id = '' } = useParams();
  const [q, setQ] = useSearchParams();
  const { me } = useMe();
  const { data: p, mutate: mutateP } = useProperty(id);
  const { data: units, mutate: mutateU } = useUnits(id);
  const [dialog, setDialog] = useState<
    null | { kind: 'edit' } | { kind: 'unit'; unit?: Unit } | { kind: 'owner'; unit: Unit } | { kind: 'fees'; unit: Unit } | { kind: 'propowner' } | { kind: 'sync'; unit: Unit }
  >(null);
  const role = me?.activeOrg?.role;
  const canWrite = !!role && can(role, 'inventory.write');
  const canOwners = !!role && can(role, 'owners.write');
  const canSync = !!role && can(role, 'ical.read');
  useEffect(() => {
    const u = q.get('unit');
    if (u && units && canSync && units.items.some((x) => x.id === u)) {
      setDialog({ kind: 'sync', unit: units.items.find((x) => x.id === u)! });
      // Clear the param: while it sits in the URL, any later revalidation of units re-runs this
      // effect and re-opens the dialog the user just closed.
      setQ(
        (prev) => {
          prev.delete('unit');
          return prev;
        },
        { replace: true },
      );
    }
  }, [units]);
  if (!p || !units) return <Spinner />;
  const close = () => setDialog(null);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={p.name}
        back={
          <Link to="/settings/properties" aria-label="Back to properties" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand">
            <ChevronLeft size={16} aria-hidden />
            Properties
          </Link>
        }
        actions={
          canWrite && (
            <>
              <Button variant="secondary" onClick={() => setDialog({ kind: 'edit' })}>
                Edit
              </Button>
              <Button onClick={() => setDialog({ kind: 'unit' })}>Add unit</Button>
              {canOwners && (
                <Button variant="secondary" onClick={() => setDialog({ kind: 'propowner' })}>
                  Default owner
                </Button>
              )}
            </>
          )
        }
      />
      <Card className="flex flex-col gap-1">
        <p className="text-sm text-ink-muted">{p.address}</p>
        <p className="text-sm">{feeSummary(p, formatNaira)}</p>
        <p className="text-sm">Default owner: <span className="font-semibold">{p.defaultOwnerName ?? 'Operator'}</span></p>
      </Card>
      {units.items.length === 0 ? (
        <EmptyState title="No units yet" body="Add the apartments guests can book." />
      ) : (
        units.items.map((u) => (
          <Card key={u.id} className="flex flex-col gap-3">
            <div>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {u.name} {!u.active && <Badge>Archived</Badge>}
                  </span>
                }
              />
              <p className="num -mt-2 text-sm text-ink-muted">
                {u.bedrooms} bed · up to {u.maxGuests} guests · {formatNaira(u.nightlyRateKobo)} / night
              </p>
              <p className="text-sm">{u.currentOwner ? `${u.currentOwner.name}${SOURCE[u.currentOwnerSource]}` : 'Operator-owned'}</p>
            </div>
            <div className="-mx-2 flex flex-wrap gap-1 border-t border-line pt-2">
              {canWrite && (
                <Button variant="ghost" onClick={() => setDialog({ kind: 'unit', unit: u })}>
                  Edit
                </Button>
              )}
              <Button variant="ghost" onClick={() => setDialog({ kind: 'fees', unit: u })}>
                Fees
              </Button>
              {canSync && (
                <Button variant="ghost" onClick={() => setDialog({ kind: 'sync', unit: u })}>
                  Calendar sync
                </Button>
              )}
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
      <Dialog open={dialog?.kind === 'propowner'} onClose={close} title="Property default owner">
        {dialog?.kind === 'propowner' && (
          <PropertyOwnerForm
            propertyId={p.id}
            currentName={p.defaultOwnerName}
            onSaved={async () => {
              close();
              await mutateP();
              await mutateU();
            }}
          />
        )}
      </Dialog>
      <Dialog open={dialog?.kind === 'sync'} onClose={close} title="Calendar sync">
        {dialog?.kind === 'sync' && <CalendarSyncPanel unitId={dialog.unit.id} canWrite={!!role && can(role, 'ical.write')} />}
      </Dialog>
      <Dialog open={dialog?.kind === 'fees'} onClose={close} title="Fees">
        {dialog?.kind === 'fees' && <UnitFees unitId={dialog.unit.id} canWrite={canWrite} />}
      </Dialog>
    </div>
  );
}
