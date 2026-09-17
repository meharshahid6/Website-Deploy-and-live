import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8790",
    headless: true,
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
        channel: "chrome",
      },
    },
  ],
  webServer: {
    command:
      "npx wrangler d1 migrations apply launchdock --local --persist-to .wrangler/browser-state && npx wrangler dev --env-file tests/browser.env --ip 127.0.0.1 --port 8790 --persist-to .wrangler/browser-state --var LOCAL_DEV:true --var APP_ORIGIN:http://127.0.0.1:8790",
    url: "http://127.0.0.1:8790/api/health",
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_LOG_PATH: ".wrangler/logs",
    },
  },
});
