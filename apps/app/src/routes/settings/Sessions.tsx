import useSWR from 'swr';
import { Button, Card, PageHeader, Spinner } from '@boogbe/ui';
import { authClient } from '../../lib/auth-client';

export function Sessions() {
  const { data, mutate } = useSWR('sessions', async () => (await authClient.listSessions()).data);
  if (!data) return <Spinner />;
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title="Signed-in devices" />
      <Card className="flex flex-col gap-3">
        <div>
          {data.map((s) => (
            <p key={s.id} className="border-t border-line py-3 text-sm first:border-t-0">
              {s.userAgent ?? 'Unknown device'} · {new Date(s.createdAt).toLocaleString('en-NG')}
            </p>
          ))}
        </div>
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
    </div>
  );
}
