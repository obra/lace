// ABOUTME: Playwright configuration for end-to-end testing
// ABOUTME: Configures browser testing environment and test settings

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',

  // Enable parallel execution - this was previously disabled
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,

  // Increase timeout for CI where server startup is slower
  timeout: process.env.CI ? 120000 : 60000,

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
    // WebKit disabled due to timing and compatibility issues
  ],

  // Per-test servers are managed by setupTestEnvironment/cleanupTestEnvironment
  // No global webServer needed

  // Global setup for worker isolation
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
});
