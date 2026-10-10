import { execSync } from 'node:child_process';

export const platformAdmin = { email: 'platform@e2e.boogbe', password: 'e2e-platform-password' };

export function resetDb() {
  execSync('pnpm --filter @boogbe/api exec tsx scripts/e2e-reset.ts', { stdio: 'inherit' });
}

export async function lastEmailTo(email: string): Promise<{ text: string } | null> {
  const r = await fetch(`http://localhost:3060/v1/__test/mail?to=${encodeURIComponent(email)}`);
  return r.json();
}
