import { Card } from '@boogbe/ui';
import { useMe } from '../lib/use-me';

export function Home() {
  const { me } = useMe();
  return (
    <Card>
      <h1 className="text-xl font-semibold">Welcome to {me?.activeOrg?.name}</h1>
      <p className="text-ink-muted">Your calendar will appear here.</p>
    </Card>
  );
}
