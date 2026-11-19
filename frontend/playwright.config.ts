import { defineConfig, devices } from "@playwright/test";

/**
 * The dev server runs on 3000 (`npm run dev`), so that is the base URL.
 * It previously pointed at 3001, a port nothing serves by default: every test
 * either timed out or needed a hand-started second server.
 *
 * Browsers: by default Playwright uses its own bundled Chromium. Set
 * PLAYWRIGHT_CHANNEL=chrome to use a system Chrome instead (useful on a machine
 * where `npx playwright install` has not been run; GitHub runners ship Chrome).
 */
const channel = process.env.PLAYWRIGHT_CHANNEL as
  | "chrome"
  | "msedge"
  | "chromium"
  | undefined;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    actionTimeout: 15000,
    navigationTimeout: 30000,
    ...(channel ? { channel } : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
