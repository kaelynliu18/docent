import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against a production build with its own throwaway PGlite database.
 * Run `pnpm build` first. Images load from Wikimedia Commons, so a network is needed.
 */
const env = "PGLITE_DIR=.data/e2e PHOTO_DIR=.data/e2e/photos AUTH_SECRET=e2e-secret-at-least-32-characters-long CRON_SECRET=e2e-cron-secret-123456";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { baseURL: "http://localhost:3200", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  workers: 1,
  webServer: {
    command: `rm -rf .data/e2e && ${env} pnpm db:seed && ${env} PORT=3200 pnpm start`,
    url: "http://localhost:3200/login",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
