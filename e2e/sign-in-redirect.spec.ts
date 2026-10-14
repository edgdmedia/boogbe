import { expect, test, type Page } from '@playwright/test';
import { platformAdmin, resetDb } from './fixtures';
import { onboardOperator } from './helpers';

test.beforeAll(() => resetDb());

// T-M2-13: opening the app signed out caches a 401 for /v1/me; signing in through the form must still land on the
// right page in the same page load — no reload, no second visit to `/`.
const signInFromRoot = async (page: Page, email: string, password: string) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2F$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
};

test('a platform admin who opens the app signed out lands on Platform after signing in', async ({ page }) => {
  await signInFromRoot(page, platformAdmin.email, platformAdmin.password);
  await expect(page).toHaveURL(/\/platform$/);
});

test('an operator admin who opens the app signed out is asked to choose the operator after signing in', async ({ page, browser }) => {
  const admin = await onboardOperator(page, browser, 'tanu-signin');
  await admin.context().clearCookies(); // signed out (the Sign out button sits in a menu on mobile)
  await signInFromRoot(admin, 'admin@tanu-signin.test', 'correct-horse-battery');
  await expect(admin).toHaveURL(/\/choose-operator$/);
  await expect(admin.getByText('Tanuhomes')).toBeVisible();
});

test('a signed-in user who opens the sign-in page goes straight on, never off-site', async ({ page }) => {
  await signInFromRoot(page, platformAdmin.email, platformAdmin.password);
  await expect(page).toHaveURL(/\/platform$/);
  await page.goto('/auth/sign-in?next=%2Fplatform');
  await expect(page).toHaveURL(/\/platform$/);
  await page.goto('/auth/sign-in?next=%2F%2Fevil.example');
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/platform$/);
  await expect(page.getByLabel('Password')).toHaveCount(0);
});
