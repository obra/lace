// ABOUTME: Playwright configuration for end-to-end testing
// ABOUTME: Configures browser testing environment and test settings

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/playwright-e2e',
  testMatch: '**/*.e2e.ts',

  fullyParallel: false, // Disable parallel execution to avoid state conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Use only 1 worker to avoid DB conflicts
  reporter: 'html',

  use: {
    // No global baseURL - each test will start its own server
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // Set longer timeout to accommodate server startup and project creation
  timeout: 60000, // 60 seconds per test

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // No global webServer - each test file starts its own server
});
