import { defineConfig, devices } from '@playwright/test';

// E2E_APP_PORT / E2E_API_PORT let a dev machine run E2E while something else holds 5173 / 3060.
const appPort = Number(process.env.E2E_APP_PORT ?? 5173);
const apiPort = Number(process.env.E2E_API_PORT ?? 3060);
// E2E_BASE_URL (e.g. https://app.boogbe.com): production smoke — no local servers, desktop only, nothing reset
// (see e2e/fixtures.ts and docs/RUNBOOK.md → Production E2E).
const prodBase = process.env.E2E_BASE_URL;
const appOrigin = prodBase ?? `http://localhost:${appPort}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: appOrigin, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    ...(prodBase ? [] : [{ name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 740 } } }]),
  ],
  webServer: prodBase ? undefined : [
    {
      command: `PORT=${apiPort} E2E=1 NODE_ENV=test APP_ORIGIN=${appOrigin} API_PUBLIC_ORIGIN=http://localhost:${apiPort} MEDIA_PUBLIC_BASE=http://localhost:${apiPort}/v1/__media BETTER_AUTH_URL=${appOrigin} pnpm --filter @boogbe/api dev`,
      url: `http://localhost:${apiPort}/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `API_PROXY_TARGET=http://localhost:${apiPort} pnpm --filter @boogbe/app dev --port ${appPort} --strictPort`,
      url: appOrigin,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
