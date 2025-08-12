// ABOUTME: Global teardown for Playwright tests - runs once after all tests
// ABOUTME: Cleans up any shared test infrastructure

import { FullConfig } from '@playwright/test';

async function globalTeardown(config: FullConfig): Promise<void> {
  console.log('🎭 Playwright test suite teardown complete');
}

export default globalTeardown;