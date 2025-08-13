// ABOUTME: Global setup for Playwright tests - runs once before all tests
// ABOUTME: Sets up any shared test infrastructure needed across workers

import { FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig): Promise<void> {
  console.log('🎭 Starting Playwright test suite setup');
  
  // Any global setup needed (currently none, but placeholder for future needs)
}

export default globalSetup;