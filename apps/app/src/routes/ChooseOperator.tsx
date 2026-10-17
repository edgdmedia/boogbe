import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROLE_LABELS } from '@boogbe/shared';
import { Button, Card, Spinner } from '@boogbe/ui';
import { authClient } from '../lib/auth-client';
import { useMe } from '../lib/use-me';
import { useRefreshSession } from '../lib/use-refresh-session';
import { AuthFrame } from './auth/AuthFrame';

export function ChooseOperator() {
  const { me } = useMe();
  const nav = useNavigate();
  const refreshSession = useRefreshSession();
  const [error, setError] = useState<string>();
  const autoOpened = useRef(false);

  // Drops every cached query (they belong to no org) and reloads the session in place: no full page reload.
  const open = async (orgId: string) => {
    setError(undefined);
    const r = await authClient.organization.setActive({ organizationId: orgId });
    if (r?.error) return setError('Could not open that operator. Try again.');
    try {
      // Without an active org the landing page would send us straight back here, round and round.
      if (!(await refreshSession())?.activeOrg) throw new Error('no active org');
    } catch {
      return setError('Could not open that operator. Try again.');
    }
    nav('/', { replace: true });
  };

  const only = me && !me.activeOrg && me.memberships.length === 1 ? me.memberships[0]!.orgId : undefined;
  useEffect(() => {
    // A session from before the server picked the only operator itself; the ref survives StrictMode's double effect.
    if (!only || autoOpened.current) return;
    autoOpened.current = true;
    void open(only);
  });

  if (!me || (only && !error)) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  }
  return (
    <AuthFrame>
      <div className="flex flex-col gap-3">
      <h1 className="mb-3 text-[26px] font-bold tracking-[-0.02em]">Choose an operator</h1>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {me.memberships.map((m) => (
        <Card key={m.orgId} className="flex items-center justify-between gap-3 p-4">
          <span>
            <span className="font-semibold">{m.orgName}</span> <span className="text-sm text-ink-muted">{ROLE_LABELS[m.role]}</span>
          </span>
          <Button onClick={() => open(m.orgId)}>Open</Button>
        </Card>
      ))}
      </div>
    </AuthFrame>
  );
}
