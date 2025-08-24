// ABOUTME: Global teardown for Playwright tests - runs once after all tests
// ABOUTME: Cleans up any shared test infrastructure

import type { FullConfig } from '@playwright/test';

async function globalTeardown(_config: FullConfig): Promise<void> {
  // Playwright test suite teardown complete
  await Promise.resolve(); // Satisfy async requirement
}

export default globalTeardown;
