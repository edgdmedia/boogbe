import { useSWRConfig } from 'swr';
import { ROLE_LABELS } from '@boogbe/shared';
import { Select } from '@boogbe/ui';
import { authClient } from '../../lib/auth-client';
import { useMe } from '../../lib/use-me';

export function OrgSwitcher() {
  const { me } = useMe();
  const { mutate } = useSWRConfig();
  if (!me || me.memberships.length < 2) return <span className="font-semibold">{me?.activeOrg?.name}</span>;
  return (
    <Select
      aria-label="Operator"
      value={me.activeOrg?.id ?? ''}
      onChange={async (e) => {
        await authClient.organization.setActive({ organizationId: e.target.value });
        await mutate(() => true, undefined, { revalidate: true }); // every cached query belongs to the old org
        window.location.assign('/');
      }}
    >
      {me.memberships.map((m) => (
        <option key={m.orgId} value={m.orgId}>
          {m.orgName} · {ROLE_LABELS[m.role]}
        </option>
      ))}
    </Select>
  );
}
