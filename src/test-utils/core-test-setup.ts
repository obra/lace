// ABOUTME: Shared test setup for core Lace tests
// ABOUTME: Provides unified setup that handles temp LACE_DIR and persistence automatically

import { useTempLaceDir, type TempLaceDirContext } from '~/test-utils/temp-lace-dir';
import { resetPersistence } from '~/persistence/database';
import { beforeEach } from 'vitest';

/**
 * Complete test setup for core tests - handles temp LACE_DIR isolation and persistence reset
 * Use this instead of manually calling useTempLaceDir() and setupTestPersistence()
 *
 * Persistence automatically initializes to ${LACE_DIR}/lace.db on first use via getPersistence()
 *
 * @returns TempLaceDirContext for tests that need access to the temp directory
 */
export function setupCoreTest(): TempLaceDirContext {
  const tempLaceDir = useTempLaceDir();

  // Reset persistence before each test - it will auto-initialize to temp directory on first use
  beforeEach(() => {
    resetPersistence();
  });

  return tempLaceDir;
}
