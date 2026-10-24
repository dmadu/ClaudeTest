import { defineConfig } from '@playwright/test'

// These tests drive the running app (docker compose up) with the mock AAF login.
// Locally they use the installed Google Chrome; in CI they use Playwright's Chromium.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    channel: process.env.CI ? undefined : 'chrome',
    trace: 'retain-on-failure',
  },
})
