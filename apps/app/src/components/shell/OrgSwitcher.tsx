import clsx from 'clsx';
import { useSWRConfig } from 'swr';
import { ROLE_LABELS } from '@boogbe/shared';
import { Select } from '@boogbe/ui';
import { authClient } from '../../lib/auth-client';
import { useMe } from '../../lib/use-me';

/** `tone="dark"` sits on the sidebar; the default sits on the light phone header. */
export function OrgSwitcher({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { me } = useMe();
  const { mutate } = useSWRConfig();
  if (!me || me.memberships.length < 2)
    return <span className={clsx('truncate font-semibold', tone === 'dark' ? 'text-sidebar-ink' : 'text-ink')}>{me?.activeOrg?.name}</span>;
  return (
    <Select
      aria-label="Operator"
      value={me.activeOrg?.id ?? ''}
      className={tone === 'dark' ? 'min-h-10 border-white/10 bg-sidebar-hover text-sidebar-ink focus:bg-sidebar-hover' : undefined}
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
