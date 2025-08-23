// ABOUTME: Playwright configuration for end-to-end testing
// ABOUTME: Configures browser testing environment and test settings

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',

  // Enable parallel execution - this was previously disabled
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : 2, // Use multiple workers instead of 1

  // Enhanced reporting and debugging
  reporter: [
    ['html', { outputFolder: 'temp/playwright-report' }],
    ['list'],
    ['junit', { outputFile: 'temp/playwright-report/junit.xml' }],
  ],

  use: {
    // No baseURL - each test uses its own server URL from setupTestEnvironment
    trace: 'retain-on-failure', // More comprehensive than 'on-first-retry'
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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

  // Per-test servers are now managed by setupTestEnvironment/cleanupTestEnvironment
  // No global webServer needed

  // Global setup for worker isolation
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
});
