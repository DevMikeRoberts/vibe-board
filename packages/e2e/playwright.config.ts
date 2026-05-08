import { defineConfig } from '@playwright/test';

// Use separate ports for E2E tests so they don't collide with
// the dev server (3001/4175) running in the background.
const TEST_SERVER_PORT = 3002;
const TEST_CLIENT_PORT = 4176;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${TEST_CLIENT_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node ../../scripts/e2e-server.cjs',
      port: TEST_SERVER_PORT,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      command: 'node ../../scripts/e2e-client.cjs',
      port: TEST_CLIENT_PORT,
      reuseExistingServer: false,
      timeout: 15_000,
    },
  ],
});
