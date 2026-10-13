import { expect, test } from '@playwright/test';
import { resetDb } from './fixtures';
import { createUnit, onboardOperator } from './helpers';

test.beforeAll(() => resetDb());

// The grid drag is a desktop interaction; mobile gets the day list + /bookings/new path (E2E-03).

test.beforeEach(() => {
test.skip(test.info().project.name === 'mobile', 'desktop-only: calendar grid drag');
});

test('E2E-02 admin adds a unit and books it from the calendar', async ({ page, browser }) => {
  const admin = await onboardOperator(page, browser);
  await createUnit(admin, { property: 'The Rock', unit: 'Kairo', rateNaira: '200000' });
  await admin.goto('/calendar');
  const cells = admin.locator('[data-testid^="cell-"]');
  const first = cells.nth(3);
  const last = cells.nth(5);
  await first.hover();
  await admin.mouse.down();
  await last.hover();
  await admin.mouse.up();
  await expect(admin.getByRole('heading', { name: 'New booking' })).toBeVisible();
  await expect(admin.getByText('3 nights × ₦200,000')).toBeVisible();
  await admin.getByRole('button', { name: 'New guest' }).click();
  await admin.getByLabel('Full name').fill('Adaeze Okafor');
  await admin.getByLabel(/^Phone/).fill('08031234567');
  await admin.getByRole('button', { name: 'Add guest' }).click();
  await expect(admin.getByText('Adaeze Okafor')).toBeVisible(); // the picker's selected chip — wait before submitting
  await admin.getByRole('button', { name: 'Save booking' }).click();
  await expect(admin).toHaveURL(/\/bookings\//);
  await expect(admin.getByText('₦600,000').first()).toBeVisible();
  await expect(admin.getByText('Tentative', { exact: true })).toBeVisible(); // status badge (also sr-only + history line match otherwise)
});
