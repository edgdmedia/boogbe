import clsx from 'clsx';
import type { ChangeEvent } from 'react';
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
  const props = {
    'aria-label': 'Operator',
    value: me.activeOrg?.id ?? '',
    onChange: async (e: ChangeEvent<HTMLSelectElement>) => {
      await authClient.organization.setActive({ organizationId: e.target.value });
      await mutate(() => true, undefined, { revalidate: true }); // every cached query belongs to the old org
      window.location.assign('/');
    },
    children: me.memberships.map((m) => (
      <option key={m.orgId} value={m.orgId}>
        {m.orgName} · {ROLE_LABELS[m.role]}
      </option>
    )),
  };
  // The shared Select's light field colours win any class conflict (stylesheet order), so the
  // sidebar gets its own plain select rather than overrides on top of them.
  if (tone === 'dark')
    return (
      <select
        {...props}
        className="min-h-11 w-full rounded-control border border-white/10 bg-sidebar-hover px-3 text-sm font-semibold text-sidebar-ink focus:outline-2 focus:outline-brand-400"
      />
    );
  return <Select {...props} />;
}
