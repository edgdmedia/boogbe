import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Operator } from '@boogbe/shared';
import { Building2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '@boogbe/ui';
import { useApi } from '../../lib/api';
import { formatDate } from '../../lib/format';

export function OperatorsList() {
  const { data, isLoading } = useApi('/v1/platform/operators', z.object({ items: z.array(Operator) }));
  if (isLoading || !data) return <Spinner />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Operators"
        actions={
          <Link to="/platform/new">
            <Button>New operator</Button>
          </Link>
        }
      />
      {data.items.length === 0 ? (
        <EmptyState icon={<Building2 />} title="No operators yet" body="Create the first one — Tanuhomes." />
      ) : (
        data.items.map((o) => (
          <Link key={o.id} to={`/platform/operators/${o.id}`}>
            <Card className="flex items-center justify-between">
              <div>
                <p className="font-medium">{o.name}</p>
                <p className="text-sm text-ink-muted">
                  {o.slug} · created {formatDate(o.createdAt.slice(0, 10))} · {o.memberCount} members ·{' '}
                  {o.pendingInvites} pending
                </p>
              </div>
              <Badge tone={o.status === 'active' ? 'success' : 'danger'}>{o.status}</Badge>
            </Card>
          </Link>
        ))
      )}
    </div>
  );
}
