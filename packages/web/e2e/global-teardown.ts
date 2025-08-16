// ABOUTME: Global teardown for Playwright tests - runs once after all tests
// ABOUTME: Cleans up any shared test infrastructure

import { FullConfig } from '@playwright/test';
import { unlink } from 'fs/promises';

async function globalTeardown(config: FullConfig): Promise<void> {
  console.log('🎭 Starting global teardown...');

  // Clean up any temporary files
  try {
    await unlink('.playwright-server-url');
  } catch {
    // File might not exist, that's OK
  }

  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }

  console.log('🎭 Playwright test suite teardown complete');
}

export default globalTeardown;
