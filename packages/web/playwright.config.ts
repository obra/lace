// ABOUTME: Playwright configuration for end-to-end testing
// ABOUTME: Configures browser testing environment and test settings

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './__tests__/e2e',
  testMatch: '**/*.e2e.ts',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
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
      // Add test environment variables
      ANTHROPIC_KEY: process.env.ANTHROPIC_KEY || 'test-key',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY || 'test-key',
      LACE_DB_PATH: ':memory:', // Use in-memory database for tests
    },
  },
});
