import { defineConfig, devices } from "@playwright/test";

const STORE = process.env.E2E_STORE_URL ?? "http://localhost:3000";
const ADMIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3001";
const LOGISTICS = process.env.E2E_LOGISTICS_URL ?? "http://localhost:3002";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: STORE,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npm run dev:store",
      url: STORE,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: "npm run dev:admin",
      url: ADMIN,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: "npm run dev:logistics",
      url: LOGISTICS,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
