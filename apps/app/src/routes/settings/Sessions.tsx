import useSWR from 'swr';
import { Button, Card, Spinner } from '@boogbe/ui';
import { authClient } from '../../lib/auth-client';

export function Sessions() {
  const { data, mutate } = useSWR('sessions', async () => (await authClient.listSessions()).data);
  if (!data) return <Spinner />;
  return (
    <Card className="flex max-w-2xl flex-col gap-2">
      <h1 className="text-xl font-semibold">Signed-in devices</h1>
      {data.map((s) => (
        <p key={s.id} className="text-sm">
          {s.userAgent ?? 'Unknown device'} · {new Date(s.createdAt).toLocaleString('en-NG')}
        </p>
      ))}
      <Button
        variant="secondary"
        onClick={async () => {
          await authClient.revokeOtherSessions();
          await mutate();
        }}
      >
        Sign out other devices
      </Button>
    </Card>
  );
}
