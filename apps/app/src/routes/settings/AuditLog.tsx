import { useState } from 'react';
import { z } from 'zod';
import { AuditEntry } from '@boogbe/shared';
import { Input, PageHeader, Spinner, Table } from '@boogbe/ui';
import { useApi } from '../../lib/api';

export function AuditLog() {
  const [entity, setEntity] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const qs = new URLSearchParams({ ...(entity && { entity }), ...(cursor && { cursor }) }).toString();
  const { data } = useApi(`/v1/audit?${qs}`, z.object({ items: z.array(AuditEntry), nextCursor: z.string().nullable() }));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Audit log"
        actions={
          <Input
            aria-label="Filter by type"
            placeholder="e.g. booking, payment"
            value={entity}
            onChange={(e) => {
              setCursor(null);
              setEntity(e.target.value);
            }}
            className="w-56"
          />
        }
      />
      {!data ? (
        <Spinner />
      ) : (
        <Table
          rows={data.items}
          columns={[
            { key: 'at', header: 'When', cell: (r) => new Date(r.at).toLocaleString('en-NG') },
            { key: 'who', header: 'Who', cell: (r) => r.actorName ?? 'System' },
            { key: 'what', header: 'Action', cell: (r) => r.action },
            { key: 'id', header: 'Record', cell: (r) => `${r.entity} ${r.entityId.slice(-6)}` },
            {
              key: 'chg',
              header: 'Change',
              cell: (r) => (
                <details>
                  <summary className="cursor-pointer text-brand">View</summary>
                  <pre className="max-w-md overflow-x-auto text-xs">{JSON.stringify({ before: r.before, after: r.after }, null, 2)}</pre>
                </details>
              ),
            },
          ]}
        />
      )}
      {data?.nextCursor && (
        <button className="self-center text-sm text-brand" onClick={() => setCursor(data.nextCursor)}>
          Older
        </button>
      )}
    </div>
  );
}
