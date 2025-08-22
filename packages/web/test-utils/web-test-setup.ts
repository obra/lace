// ABOUTME: Shared test setup for web package tests
// ABOUTME: Provides unified setup that handles temp LACE_DIR and persistence automatically

import { useTempLaceDir, resetPersistence, ProviderRegistry } from '@/lib/server/lace-imports';
import type { TempLaceDirContext } from '@/types/core';
import { beforeEach, afterEach } from 'vitest';

/**
 * Complete test setup for web tests - handles temp LACE_DIR isolation and persistence reset
 * Use this instead of manually calling useTempLaceDir() and setupTestPersistence()
 *
 * Persistence automatically initializes to ${LACE_DIR}/lace.db on first use via getPersistence()
 *
 * @returns TempLaceDirContext for tests that need access to the temp directory
 */
export function setupWebTest(): TempLaceDirContext {
  const tempLaceDir = useTempLaceDir();

  // Reset persistence and provider registry before each test
  beforeEach(() => {
    resetPersistence();
    ProviderRegistry.clearInstance();
  });

  // Clear provider registry after each test to ensure isolation
  afterEach(() => {
    ProviderRegistry.clearInstance();
  });

  return tempLaceDir;
}
