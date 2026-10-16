import { expect, type Browser, type Page } from '@playwright/test';
import { PROD, inviteEmail, inviteUrl, operatorName, platformAdmin, slugFor } from './fixtures';

/** Signs the platform admin in and opens Platform. In production the owner's account is also a Tanuhomes admin,
 *  so it lands in Tanuhomes (RoleLanding); Platform is opened explicitly there. */
export async function signInPlatformAdmin(page: Page): Promise<void> {
  await page.goto('/auth/sign-in');
  await page.getByLabel('Email').fill(platformAdmin.email);
  await page.getByLabel('Password').fill(platformAdmin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/'));
  if (PROD) await page.goto('/platform');
  await expect(page.getByRole('heading', { name: 'Operators' })).toBeVisible();
}

/** E2E-01's flow as a reusable prologue: platform admin creates the operator and invites its first admin,
 *  who accepts from the invitation link in a second browser context and lands on the calendar.
 *  In production mode the slug becomes `e2e-<run>-<base>` (see fixtures.ts). */
export async function onboardOperator(page: Page, browser: Browser, base = 'tanuhomes'): Promise<Page> {
  const slug = slugFor(base);
  const name = operatorName(base);
  const email = inviteEmail(slug);
  await signInPlatformAdmin(page);
  await page.getByRole('button', { name: 'New operator' }).click();
  await page.getByLabel('Business name').fill(name);
  await page.getByLabel('Slug').fill(slug);
  await page.getByRole('button', { name: 'Create operator' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible(); // the detail page (and its Email field) is the invite form's own — wait for the swap
  await page.getByLabel('Email').fill(email);
  await expect(page.getByLabel('Email')).toHaveValue(email);
  const url = await inviteUrl(page, email, async () => {
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Invitation sent' })).toBeVisible();
  });
  const ctx = await browser.newContext();
  const admin = await ctx.newPage();
  await admin.goto(url);
  await admin.getByLabel('Your name').fill('Tanu Admin');
  await admin.getByLabel('Password').fill('correct-horse-battery');
  await admin.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(admin).toHaveURL(/\/calendar$/);
  return admin;
}

export async function createUnit(page: Page, o: { property: string; unit: string; rateNaira: string }): Promise<void> {
  await page.goto('/settings/properties');
  await page.getByRole('button', { name: 'Add property' }).click();
  await page.getByLabel('Name').fill(o.property);
  await page.getByLabel('Address').fill('Lekki Phase 1, Lagos');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Add unit' }).click();
  await page.getByLabel('Unit name').fill(o.unit);
  await page.getByLabel('Nightly rate').fill(o.rateNaira);
  await page.getByLabel('Max guests').fill('4');
  await page.getByRole('button', { name: 'Save unit' }).click();
  await expect(page.getByText(o.unit)).toBeVisible();
}
