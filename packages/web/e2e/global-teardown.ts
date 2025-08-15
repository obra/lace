// ABOUTME: Global teardown for Playwright tests - runs once after all tests
// ABOUTME: Cleans up any shared test infrastructure including test server

import { FullConfig } from '@playwright/test';
import { shutdownTestServer } from './utils/withTempLaceDir';

async function globalTeardown(config: FullConfig): Promise<void> {
  // Shut down the test server
  await shutdownTestServer();
  console.log('🎭 Playwright test suite teardown complete');
}

export default globalTeardown;