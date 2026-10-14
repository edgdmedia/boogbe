import { execSync } from 'node:child_process';
import type { Page } from '@playwright/test';

/**
 * Production smoke mode: E2E_BASE_URL=https://app.boogbe.com (see docs/RUNBOOK.md → Production E2E).
 * Never resets anything; every operator it creates is named `e2e-<run>-…` so purge-e2e-operators.ts can remove them.
 */
export const PROD = !!process.env.E2E_BASE_URL;
const RUN = process.env.E2E_RUN_ID ?? Date.now().toString(36);
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required when E2E_BASE_URL is set`);
  return v;
};

export const platformAdmin = PROD
  ? { email: need('E2E_ADMIN_EMAIL'), password: need('E2E_ADMIN_PASSWORD') }
  : { email: 'platform@e2e.boogbe', password: 'e2e-platform-password' };

/** Operator slug; in production prefixed with the run id so it can never collide with a real operator. */
export const slugFor = (base: string) => (PROD ? `e2e-${RUN}-${base}` : base);
/** Display name for the operator a test creates. */
export const operatorName = (base: string) => (PROD ? `E2E ${RUN} ${base}` : 'Tanuhomes');
/** Where its admin invitation goes: a +tag of a real inbox in production (E2E_INVITE_EMAIL), a .test address locally. */
export const inviteEmail = (slug: string) => (PROD ? need('E2E_INVITE_EMAIL').replace('@', `+${slug}@`) : `admin@${slug}.test`);

/** Local only: production is never reset. */
export function resetDb() {
  if (PROD) return;
  execSync('pnpm --filter @boogbe/api exec tsx scripts/e2e-reset.ts', { stdio: 'inherit' });
}

export async function lastEmailTo(email: string): Promise<{ text: string } | null> {
  const r = await fetch(`http://localhost:${process.env.E2E_API_PORT ?? 3060}/v1/__test/mail?to=${encodeURIComponent(email)}`);
  const t = await r.text(); // Nest sends an empty body for a null result
  return t ? JSON.parse(t) : null;
}

/**
 * Sends the admin invitation (via `send`) and returns its accept link: from the test mailbox locally, from the
 * invite API response in production (there is no test mailbox there, and the real email goes to E2E_INVITE_EMAIL).
 */
export async function inviteUrl(page: Page, email: string, send: () => Promise<void>): Promise<string> {
  if (!PROD) {
    await send();
    const mail = await lastEmailTo(email);
    return /(http\S+\/auth\/accept-invite\/\S+)/.exec(mail!.text)![1]!;
  }
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && /\/invite-admin$/.test(new URL(r.url()).pathname)),
    send(),
  ]);
  const { id } = (await res.json()) as { id: string };
  return `${process.env.E2E_BASE_URL}/auth/accept-invite/${id}`;
}
