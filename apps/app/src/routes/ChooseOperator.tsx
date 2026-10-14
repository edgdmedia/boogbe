import { ROLE_LABELS } from '@boogbe/shared';
import { Button, Card } from '@boogbe/ui';
import { authClient } from '../lib/auth-client';
import { useMe } from '../lib/use-me';

export function ChooseOperator() {
  const { me } = useMe();
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-3 p-4 pt-16">
      <h1 className="text-xl font-semibold">Choose an operator</h1>
      {me?.memberships.map((m) => (
        <Card key={m.orgId} className="flex items-center justify-between">
          <span>
            {m.orgName} <span className="text-sm text-ink-muted">{ROLE_LABELS[m.role]}</span>
          </span>
          <Button
            onClick={async () => {
              await authClient.organization.setActive({ organizationId: m.orgId });
              window.location.assign('/');
            }}
          >
            Open
          </Button>
        </Card>
      ))}
    </main>
  );
}
