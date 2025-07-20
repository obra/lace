// ABOUTME: Test helper for persistence initialization with temporary databases
// ABOUTME: Provides reusable setup/teardown for tests that need real persistence

import {
  resetPersistence,
  initializePersistence,
  getPersistence,
  type DatabasePersistence,
} from '~/persistence/database';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

let currentTempDbPath: string | null = null;

/**
 * Initialize persistence with a temporary database for testing
 * Call this in beforeEach() for tests that need real persistence
 */
export function setupTestPersistence(): DatabasePersistence {
  currentTempDbPath = path.join(
    os.tmpdir(),
    `lace-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.db`
  );
  resetPersistence();
  initializePersistence(currentTempDbPath);
  return getPersistence();
}

/**
 * Clean up test persistence
 * Call this in afterEach() for tests that used setupTestPersistence()
 */
export function teardownTestPersistence(): void {
  resetPersistence();
  if (currentTempDbPath && fs.existsSync(currentTempDbPath)) {
    fs.unlinkSync(currentTempDbPath);
    currentTempDbPath = null;
  }
}

/**
 * Complete test helper that sets up and tears down persistence automatically
 * Use this for simpler test setup when you just need persistence available
 */
export function withTestPersistence(
  beforeEachCallback?: () => void,
  afterEachCallback?: () => void
) {
  return {
    beforeEach: () => {
      setupTestPersistence();
      beforeEachCallback?.();
    },
    afterEach: () => {
      afterEachCallback?.();
      teardownTestPersistence();
    },
  };
}
