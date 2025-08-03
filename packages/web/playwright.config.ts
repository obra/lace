// ABOUTME: Playwright configuration for end-to-end testing
// ABOUTME: Configures browser testing environment and test settings

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',

  fullyParallel: false, // Disable parallel execution to avoid state conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Use only 1 worker to avoid DB conflicts
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:23457', // Playwright will use the actual port the server starts on
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
    command: 'node scripts/start-test-server.js', // Use our wrapper script
    port: 23457, // Start checking from this port
    reuseExistingServer: !process.env.CI,
    timeout: 60 * 1000,
  },
});
