import { expect, test } from '@playwright/test';
import { lastEmailTo, platformAdmin, resetDb } from './fixtures';

test.beforeAll(() => resetDb());

test('E2E-01 platform admin creates operator, invites admin, admin lands on calendar', async ({ page, browser }) => {
  await page.goto('/auth/sign-in');
  await page.getByLabel('Email').fill(platformAdmin.email);
  await page.getByLabel('Password').fill(platformAdmin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Operators' })).toBeVisible();

  await page.getByRole('button', { name: 'New operator' }).click();
  await page.getByLabel('Business name').fill('Tanuhomes');
  await page.getByLabel('Slug').fill('tanuhomes');
  await page.getByRole('button', { name: 'Create operator' }).click();
  await expect(page.getByRole('heading', { name: 'Tanuhomes' })).toBeVisible();

  await page.getByLabel('Email').fill('admin@tanuhomes.test');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Invitation sent' })).toBeVisible();

  const mail = await lastEmailTo('admin@tanuhomes.test');
  const url = /(http\S+\/auth\/accept-invite\/\S+)/.exec(mail!.text)![1]!;

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto(url);
  await expect(p2.getByRole('heading', { name: /Join Tanuhomes as Admin/ })).toBeVisible();
  await p2.getByLabel('Your name').fill('Tanu Admin');
  await p2.getByLabel('Password').fill('correct-horse-battery');
  await p2.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(p2).toHaveURL(/\/calendar$/);
  await expect(p2.getByText('Welcome to Tanuhomes')).toBeVisible();
});
