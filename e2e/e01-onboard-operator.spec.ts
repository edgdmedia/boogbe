import { expect, test } from '@playwright/test';
import { inviteEmail, inviteUrl, operatorName, resetDb, slugFor } from './fixtures';
import { signInPlatformAdmin } from './helpers';

test.beforeAll(() => resetDb());

test('E2E-01 platform admin creates operator, invites admin, admin lands on calendar', async ({ page, browser }) => {
  const slug = slugFor('tanuhomes');
  const name = operatorName('tanuhomes');
  const email = inviteEmail(slug);
  await signInPlatformAdmin(page);

  await page.getByRole('button', { name: 'New operator' }).click();
  await page.getByLabel('Business name').fill(name);
  await page.getByLabel('Slug').fill(slug);
  await page.getByRole('button', { name: 'Create operator' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();

  await page.getByLabel('Email').fill(email);
  const url = await inviteUrl(page, email, async () => {
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Invitation sent' })).toBeVisible();
  });

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto(url);
  await expect(p2.getByRole('heading', { name: new RegExp(`Join ${name} as Admin`) })).toBeVisible();
  await p2.getByLabel('Your name').fill('Tanu Admin');
  await p2.getByLabel('Password').fill('correct-horse-battery');
  await p2.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(p2).toHaveURL(/\/calendar$/);
  // M1: /calendar is the real grid now; a brand-new operator has no properties yet.
  await expect(p2.getByText('No units yet')).toBeVisible();
});
