import { expect, test, type Page } from '@playwright/test';
import { PROD, inviteEmail, platformAdmin, resetDb, slugFor } from './fixtures';
import { onboardOperator } from './helpers';

test.beforeAll(() => resetDb());

// In production the platform admin (the owner) is also a Tanuhomes admin — their only operator — so signing in opens it.
const adminHome = PROD ? /\/calendar$/ : /\/platform$/;

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
  test.skip(PROD, 'the production platform admin is also an operator member');
  await signInFromRoot(page, platformAdmin.email, platformAdmin.password);
  await expect(page).toHaveURL(/\/platform$/);
});

test('an operator admin with one operator who opens the app signed out goes straight in after signing in, no chooser', async ({ page, browser }) => {
  const admin = await onboardOperator(page, browser, 'tanu-signin');
  await admin.context().clearCookies(); // signed out (the Sign out button sits in a menu on mobile)
  await signInFromRoot(admin, inviteEmail(slugFor('tanu-signin')), 'correct-horse-battery');
  await expect(admin).toHaveURL(/\/calendar$/);
  await expect(admin.getByRole('heading', { name: 'Choose an operator' })).toHaveCount(0);
});

test('a signed-in user who opens the sign-in page goes straight on, never off-site', async ({ page, baseURL }) => {
  await signInFromRoot(page, platformAdmin.email, platformAdmin.password);
  await expect(page).toHaveURL(adminHome);
  await page.goto('/auth/sign-in?next=%2Fplatform');
  await expect(page).toHaveURL(/\/platform$/);
  await page.goto('/auth/sign-in?next=%2F%2Fevil.example');
  await expect(page).toHaveURL(adminHome);
  expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
  await expect(page.getByLabel('Password')).toHaveCount(0);
});
