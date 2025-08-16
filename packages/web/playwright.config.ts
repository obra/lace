// ABOUTME: Playwright configuration for end-to-end testing
// ABOUTME: Configures browser testing environment and test settings

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',

  // Enable parallel execution with limits to prevent resource exhaustion
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1, // Add retry for local development
  workers: process.env.CI ? 2 : 1, // Reduce workers to prevent memory issues

  // Enhanced reporting and debugging
  reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],

  use: {
    baseURL: 'http://localhost:23457',
    trace: 'retain-on-failure', // More comprehensive than 'on-first-retry'
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Add navigation and action timeouts to prevent hanging
    navigationTimeout: 30 * 1000,
    actionTimeout: 10 * 1000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // WebKit disabled in CI due to timing issues, available for local development
    ...(process.env.CI
      ? []
      : [
          {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
          },
        ]),
  ],

  webServer: {
    command: 'node scripts/start-test-server.js',
    port: 23457,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000, // Increase timeout for server startup
  },

  // Global setup for worker isolation
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
});
