// ABOUTME: Playwright config for tool approval modal E2E tests
// ABOUTME: Uses special server configuration with mock provider that returns tool calls

import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const PORT_FILE = path.join(process.cwd(), '.playwright-server-url-tool-approval');

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/tool-approval-modal.e2e.ts',
  fullyParallel: false, // Run tests sequentially to avoid conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for tool approval tests
  timeout: 60000, // 60 second timeout for tool approval interactions
  
  reporter: 'html',
  
  use: {
    baseURL: (() => {
      try {
        if (fs.existsSync(PORT_FILE)) {
          return fs.readFileSync(PORT_FILE, 'utf8').trim();
        }
      } catch (e) {
        // Fall back to default
      }
      return 'http://localhost:23458'; // Different port for tool approval tests
    })(),
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'E2E_TOOL_APPROVAL_MOCK=true node scripts/start-test-server-tool-approval.js',
    port: 23458,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: {
      E2E_TOOL_APPROVAL_MOCK: 'true',
    },
  },
});