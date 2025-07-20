// ABOUTME: Playwright configuration for end-to-end testing
// ABOUTME: Configures browser testing environment and test settings

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './__tests__/e2e',
  testMatch: '**/*.e2e.ts',

  fullyParallel: false, // Disable parallel execution to avoid state conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Use only 1 worker to avoid DB conflicts
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:3005',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3005',
    reuseExistingServer: !process.env.CI,
    timeout: 60 * 1000,
    env: {
      // Add test environment variables for E2E tests
      ANTHROPIC_KEY: 'test-anthropic-key-for-e2e-tests',
      ANTHROPIC_API_KEY: 'test-anthropic-key-for-e2e-tests',
      LACE_DB_PATH: ':memory:', // Use in-memory database for tests
      NODE_ENV: 'test', // This will enable test mocks
      VITEST_RUNNING: 'true', // Trigger test environment behavior
    },
  },
});
