import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { OperatorDetail as Detail, ROLE_LABELS } from '@boogbe/shared';
import { Badge, Button, Card, Field, Input, Spinner } from '@boogbe/ui';
import { api, useApi } from '../../lib/api';

export function OperatorDetail() {
  const { id = '' } = useParams();
  const { data, mutate } = useApi(`/v1/platform/operators/${id}`, Detail);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  if (!data) return <Spinner />;
  const act = async (path: string) => {
    await api(path, { method: 'POST' });
    await mutate();
  };
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{data.name}</h1>
        <Badge tone={data.status === 'active' ? 'success' : 'danger'}>{data.status}</Badge>
      </div>
      <Card>
        <h2 className="mb-3 font-medium">Invite an admin</h2>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMsg(undefined);
            try {
              await api(`/v1/platform/operators/${id}/invite-admin`, { method: 'POST', body: { email } });
              setEmail('');
              setMsg('Invitation sent');
              await mutate();
            } catch (err) {
              setMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" loading={busy} className="self-end">
            Send
          </Button>
        </form>
        {msg && (
          <p role="status" className="mt-2 text-sm">
            {msg}
          </p>
        )}
      </Card>
      <Card>
        <h2 className="mb-3 font-medium">Members</h2>
        {data.members.map((m) => (
          <p key={m.id} className="text-sm">
            {m.name} · {m.email} · {ROLE_LABELS[m.role]}
          </p>
        ))}
        <h2 className="mb-3 mt-4 font-medium">Invitations</h2>
        {data.invitations.map((i) => (
          <div key={i.id} className="flex items-center justify-between text-sm">
            <span>
              {i.email} · {i.role} · {i.status}
            </span>
            {i.status === 'pending' && (
              <span className="flex gap-2">
                <Button variant="ghost" onClick={() => act(`/v1/platform/invitations/${i.id}/resend`)}>
                  Resend
                </Button>
                <Button variant="ghost" onClick={() => act(`/v1/platform/invitations/${i.id}/revoke`)}>
                  Revoke
                </Button>
              </span>
            )}
          </div>
        ))}
      </Card>
      {data.status === 'active' ? (
        <Button
          variant="danger"
          onClick={() =>
            confirm(`Suspend ${data.name}? Their team will lose access.`) && act(`/v1/platform/operators/${id}/suspend`)
          }
        >
          Suspend operator
        </Button>
      ) : (
        <Button onClick={() => act(`/v1/platform/operators/${id}/reactivate`)}>Reactivate operator</Button>
      )}
    </div>
  );
}
