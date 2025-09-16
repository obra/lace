// ABOUTME: Shared test setup for core Lace tests
// ABOUTME: Provides unified setup that handles temp LACE_DIR and persistence automatically

import { useTempLaceDir, type TempLaceDirContext } from '~/test-utils/temp-lace-dir';
import { resetPersistence } from '~/persistence/database';
import { beforeEach, afterEach } from 'vitest';

export interface EnhancedTempLaceDirContext extends TempLaceDirContext {
  /** Register a cleanup function to be called in afterEach */
  registerCleanup: (fn: () => void | Promise<void>) => void;
}

/**
 * Complete test setup for core tests - handles temp LACE_DIR isolation and persistence reset
 * Use this instead of manually calling useTempLaceDir() and setupTestPersistence()
 *
 * Persistence automatically initializes to ${LACE_DIR}/lace.db on first use via getPersistence()
 *
 * @returns Enhanced TempLaceDirContext with cleanup registry for tests that need access to the temp directory
 */
export function setupCoreTest(): EnhancedTempLaceDirContext {
  const tempLaceDir = useTempLaceDir();
  const cleanupTasks: (() => void | Promise<void>)[] = [];

  // Reset persistence before each test - it will auto-initialize to temp directory on first use
  beforeEach(() => {
    resetPersistence();
    cleanupTasks.length = 0; // Reset cleanup tasks
  });

  // Run all registered cleanup tasks after each test
  afterEach(async () => {
    // Run all registered cleanup tasks
    for (const cleanup of cleanupTasks) {
      try {
        await cleanup();
      } catch (error) {
        console.warn('Cleanup task failed:', error);
      }
    }
  });

  return {
    ...tempLaceDir,
    registerCleanup: (fn: () => void | Promise<void>) => cleanupTasks.push(fn),
  };
}
