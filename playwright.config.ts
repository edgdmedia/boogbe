import { defineConfig, devices } from '@playwright/test';

// E2E_APP_PORT lets a dev machine run E2E while something else holds 5173.
const appPort = Number(process.env.E2E_APP_PORT ?? 5173);
const appOrigin = `http://localhost:${appPort}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: appOrigin, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 740 } } },
  ],
  webServer: [
    {
      command: `E2E=1 NODE_ENV=test APP_ORIGIN=${appOrigin} BETTER_AUTH_URL=${appOrigin} pnpm --filter @boogbe/api dev`,
      url: 'http://localhost:3060/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @boogbe/app dev --port ${appPort} --strictPort`,
      url: appOrigin,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
