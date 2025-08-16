// ABOUTME: Global setup for Playwright tests - runs once before all tests
// ABOUTME: Sets up any shared test infrastructure needed across workers

import { FullConfig } from '@playwright/test';
import { EventEmitter } from 'events';

async function globalSetup(config: FullConfig): Promise<void> {
  console.log('🎭 Starting Playwright test suite setup');

  // Increase max listeners globally to prevent memory leak warnings
  EventEmitter.defaultMaxListeners = 20;

  // Set Node.js max listeners
  if (process.setMaxListeners) {
    process.setMaxListeners(20);
  }

  console.log('✅ Global setup completed - memory limits configured');
}

export default globalSetup;
