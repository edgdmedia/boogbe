import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { resetDb } from './fixtures';
import { createUnit, onboardOperator } from './helpers';

const apiPort = process.env.E2E_API_PORT ?? '3060';
const photo = (name: string) => ({
  name,
  mimeType: 'image/jpeg',
  buffer: readFileSync(`e2e/fixtures/${name}`),
});

test.beforeAll(() => resetDb());

test.beforeEach(() => {
  test.skip(test.info().project.name === 'mobile', 'desktop-only: photo grid + publish flow (mirrors E2E-02 grid note)');
});

/**
 * E2E-WL smoke (plan Task 8, Step 4): create a listing, upload 3 small JPEGs with the resize job
 * triggered through the test-support route, describe them, link the unit, publish, see Published.
 */
test('admin builds a website listing end to end', async ({ page, browser }) => {
  test.setTimeout(120_000); // onboarding + uploads + a 20 s job-poll budget
  const admin = await onboardOperator(page, browser, 'tanu-web');
  await createUnit(admin, { property: 'The Rock', unit: 'Destiny 1', rateNaira: '175000' });

  await admin.goto('/website/listings');
  await admin.getByRole('button', { name: 'New listing' }).click();
  await admin.getByLabel('Name').fill('Destiny');
  await admin.getByRole('button', { name: 'Create' }).click();

  await admin.getByLabel('Intro').fill('A calm two-bedroom with a sea breeze.');
  await admin.getByLabel('Description', { exact: true }).fill('Quiet street, five minutes from the beach.');

  await admin.locator('#listing-photo-picker').setInputFiles([photo('photo-one.jpg'), photo('photo-two.jpg'), photo('photo-three.jpg')]);
  // Uploads are sequential; wait until all three are attached before firing the job pass.
  await expect(admin.getByText('Processing…')).toHaveCount(3, { timeout: 20_000 });

  // One resize pass through the test-support route (the cron only lives in the worker), then the
  // manager's 5 s refetch swaps the thumbs in.
  const run = await admin.request.post(`http://localhost:${apiPort}/v1/__test/run-photos`);
  expect(run.ok()).toBeTruthy();
  await expect(admin.locator('img[src*="/v1/__media/"]')).toHaveCount(3, { timeout: 20_000 });

  for (const [text, n] of [['Sea-facing bedroom', 0], ['Living room with balcony', 1], ['Kitchen and diner', 2]] as const) {
    const box = admin.getByLabel('Photo description').nth(n);
    await box.fill(text);
    await box.blur();
  }
  await admin.getByRole('button', { name: /set as cover/i }).first().click();
  await admin.getByRole('checkbox', { name: 'Destiny 1' }).check();
  await admin.getByRole('button', { name: 'Save' }).click();
  await expect(admin.getByText('Saved. Live on your website within a minute.')).toBeVisible();

  const publish = admin.getByRole('button', { name: 'Publish' });
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(admin.getByText('Published', { exact: true })).toBeVisible();

  await admin.goto('/settings/online-booking');
  await admin.getByLabel('Website address').fill('https://tanuhomes.example');
  await admin.getByRole('button', { name: 'Save', exact: true }).click();

  await admin.goto('/website/listings');
  await expect(admin.getByText('1 unit')).toBeVisible();
  await expect(admin.getByRole('link', { name: 'View on website' })).toHaveAttribute('href', /\/short-lets\/destiny\/$/);
});
