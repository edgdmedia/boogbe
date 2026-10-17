import { Compass } from 'lucide-react';
import { EmptyState } from '@boogbe/ui';

export function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-surface-2 p-6">
      <EmptyState icon={<Compass />} title="Page not found" />
    </main>
  );
}
