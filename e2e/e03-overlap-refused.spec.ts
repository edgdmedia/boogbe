import { expect, test } from '@playwright/test';
import { resetDb } from './fixtures';
import { createUnit, onboardOperator } from './helpers';

test.beforeAll(() => resetDb());

test('E2E-03 overlapping booking is refused with a clear message', async ({ page, browser }) => {
  const admin = await onboardOperator(page, browser, 'tanu-overlap');
  await createUnit(admin, { property: 'The Rock', unit: 'Kairo', rateNaira: '200000' });
  const units = await (await admin.request.get('/v1/units')).json();
  const unitId = units.items[0].id as string;
  const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  await admin.goto(`/bookings/new?unitId=${unitId}&checkIn=${d(2)}&checkOut=${d(5)}`);
  await admin.getByRole('button', { name: 'New guest' }).click();
  await admin.getByLabel('Full name').fill('First Guest');
  await admin.getByLabel(/^Phone/).fill('08030000001');
  await admin.getByRole('button', { name: 'Add guest' }).click();
  await expect(admin.getByText('First Guest')).toBeVisible(); // selected chip before submit
  await admin.getByRole('button', { name: 'Save booking' }).click();
  await expect(admin).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);

  await admin.goto(`/bookings/new?unitId=${unitId}&checkIn=${d(3)}&checkOut=${d(6)}`);
  await expect(admin.getByRole('alert')).toHaveText('Those dates are already booked for this unit.');
  await expect(admin.getByRole('button', { name: 'Save booking' })).toBeDisabled();
});
