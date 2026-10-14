import { expect, test } from '@playwright/test';
import { resetDb } from './fixtures';
import { createUnit, onboardOperator } from './helpers';

test.beforeAll(() => resetDb());

test('E2E-04 part-payment updates balance and the receipt downloads', async ({ page, browser }) => {
  const admin = await onboardOperator(page, browser, 'tanu-pay');
  await createUnit(admin, { property: 'The Rock', unit: 'Kairo', rateNaira: '200000' });
  const unitId = (await (await admin.request.get('/v1/units')).json()).items[0].id;
  const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  await admin.goto(`/bookings/new?unitId=${unitId}&checkIn=${d(2)}&checkOut=${d(5)}`);
  await admin.getByRole('button', { name: 'New guest' }).click();
  await admin.getByLabel('Full name').fill('Adaeze Okafor');
  await admin.getByLabel(/^Phone/).fill('08031234567');
  await admin.getByRole('button', { name: 'Add guest' }).click();
  await expect(admin.getByText('Adaeze Okafor')).toBeVisible(); // selected chip before submit (same race as E2E-02)
  await admin.getByRole('button', { name: 'Save booking' }).click();
  await admin.getByRole('button', { name: 'Record payment' }).click();
  await admin.getByLabel('Amount').fill('250000');
  await admin.getByLabel('Reference').fill('GTB-998');
  await admin.getByRole('button', { name: 'Save', exact: true }).click(); // not 'Save booking'
  await expect(admin.getByText('Confirmed', { exact: true }).first()).toBeVisible(); // auto-confirm on payment (BKG-09)
  await expect(admin.locator('dd', { hasText: '₦350,000' }).first()).toBeVisible(); // balance 600k − 250k
  const [download] = await Promise.all([admin.waitForEvent('download'), admin.getByRole('link', { name: /-R-000001/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/-R-000001\.pdf$/);
});
