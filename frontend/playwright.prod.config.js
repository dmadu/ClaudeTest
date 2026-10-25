import { defineConfig } from '@playwright/test'

// Smoke tests for a production-like deployment (deploy/rehearse.sh starts one and runs these).
// They sign in the way AAF does: with an assertion signed by the shared secret of that deployment.
export default defineConfig({
  testDir: 'e2e-prod',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://localhost',
    // A rehearsal uses Caddy's own certificate authority, which browsers do not know.
    ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS_ERRORS === '1',
    channel: process.env.CI ? undefined : 'chrome',
    trace: 'retain-on-failure',
  },
})
