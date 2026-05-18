// ABOUTME: Shared test setup for agent tests
// ABOUTME: Provides unified setup that handles temp LACE_DIR and registered cleanup tasks

import { useTempLaceDir, type TempLaceDirContext } from './temp-lace-dir';
import { beforeEach, afterEach } from 'vitest';

export interface EnhancedTempLaceDirContext extends TempLaceDirContext {
  /** Register a cleanup function to be called in afterEach */
  registerCleanup: (fn: () => void | Promise<void>) => void;
}

/**
 * Complete test setup for agent tests - handles temp LACE_DIR isolation and persistence reset
 * Use this instead of manually calling useTempLaceDir() and setupTestPersistence()
 *
 * Persistence automatically initializes to ${LACE_DIR}/lace.db on first use via getPersistence()
 *
 * @returns Enhanced TempLaceDirContext with cleanup registry for tests that need access to the temp directory
 */
export function setupCoreTest(): EnhancedTempLaceDirContext {
  const tempLaceDir = useTempLaceDir();
  const cleanupTasks: (() => void | Promise<void>)[] = [];

  beforeEach(() => {
    cleanupTasks.length = 0; // Reset cleanup tasks
  });

  // Run all registered cleanup tasks after each test
  afterEach(async () => {
    for (const cleanup of cleanupTasks) {
      try {
        await cleanup();
      } catch (error) {
        console.warn('Cleanup task failed:', error);
      }
    }
  });

  return {
    get tempDir() {
      return tempLaceDir.tempDir;
    },
    get originalLaceDir() {
      return tempLaceDir.originalLaceDir;
    },
    set originalLaceDir(value: string | undefined) {
      tempLaceDir.originalLaceDir = value;
    },
    registerCleanup: (fn: () => void | Promise<void>) => cleanupTasks.push(fn),
  };
}
