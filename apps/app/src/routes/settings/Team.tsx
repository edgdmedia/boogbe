import { useState } from 'react';
import useSWR from 'swr';
import { ORG_ROLES, ROLE_LABELS, type OrgRole } from '@boogbe/shared';
import { Button, Card, Field, Input, Select, Spinner } from '@boogbe/ui';
import { authClient } from '../../lib/auth-client';
import { useMe } from '../../lib/use-me';

export function Team() {
  const { me } = useMe();
  const orgId = me?.activeOrg?.id;
  const { data, mutate } = useSWR(
    orgId ? ['org-full', orgId] : null,
    async () => (await authClient.organization.getFullOrganization({ query: { organizationId: orgId! } })).data,
  );
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('frontdesk');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (!data) return <Spinner />;
  const run = async (p: Promise<{ error: { message?: string } | null }>) => {
    setErr(undefined);
    const r = await p;
    if (r.error) setErr(r.error.message ?? 'Failed');
    await mutate();
  };
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold">Team</h1>
      <Card>
        <form
          className="grid gap-2 md:grid-cols-[1fr_180px_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await run(authClient.organization.inviteMember({ email, role: role as never, organizationId: orgId }));
            setEmail('');
            setBusy(false);
          }}
        >
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
              {ORG_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" loading={busy} className="self-end">
            Invite
          </Button>
        </form>
        {err && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {err}
          </p>
        )}
      </Card>
      <Card className="flex flex-col gap-2">
        {data.members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {m.user.name} <span className="text-sm text-ink-muted">{m.user.email}</span>
            </span>
            <span className="flex gap-2">
              <Select
                aria-label={`Role for ${m.user.name}`}
                value={m.role}
                onChange={(e) =>
                  run(
                    authClient.organization.updateMemberRole({
                      memberId: m.id,
                      role: e.target.value as never,
                      organizationId: orgId,
                    }),
                  )
                }
              >
                {ORG_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
              <Button
                variant="ghost"
                onClick={() =>
                  confirm(`Remove ${m.user.name}?`) &&
                  run(authClient.organization.removeMember({ memberIdOrEmail: m.id, organizationId: orgId }))
                }
              >
                Remove
              </Button>
            </span>
          </div>
        ))}
        {data.invitations
          .filter((i) => i.status === 'pending')
          .map((i) => (
            <div key={i.id} className="flex items-center justify-between text-sm text-ink-muted">
              <span>
                {i.email} · {ROLE_LABELS[i.role as OrgRole]} · invited
              </span>
              <Button variant="ghost" onClick={() => run(authClient.organization.cancelInvitation({ invitationId: i.id }))}>
                Cancel
              </Button>
            </div>
          ))}
      </Card>
    </div>
  );
}
