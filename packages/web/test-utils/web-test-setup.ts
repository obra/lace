// ABOUTME: Shared test setup for web package tests
// ABOUTME: Provides unified setup that handles temp LACE_DIR and persistence automatically

import { useTempLaceDir, type TempLaceDirContext } from '@lace/core/test-utils/temp-lace-dir';
import { resetPersistence } from '@lace/core/persistence/database';
import { ProviderRegistry } from '@lace/core/providers/registry';
import { beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Extended context that includes temp project directory
 */
export interface WebTestContext extends TempLaceDirContext {
  tempProjectDir: string;
}

/**
 * Complete test setup for web tests - handles temp LACE_DIR and temp project directory
 * Use this instead of manually calling useTempLaceDir() and setupTestPersistence()
 *
 * Persistence automatically initializes to ${LACE_DIR}/lace.db on first use via getPersistence()
 *
 * @returns WebTestContext with tempDir (LACE_DIR) and tempProjectDir (for projects)
 */
export function setupWebTest(): WebTestContext {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- useTempLaceDir is not a React Hook despite naming, it's a Vitest test utility that uses beforeEach/afterEach
  const tempLaceDir = useTempLaceDir();

  let _tempProjectDir: string = '';

  const context: WebTestContext = {
    get tempDir(): string {
      return tempLaceDir.tempDir;
    },
    get originalLaceDir(): string | undefined {
      return tempLaceDir.originalLaceDir;
    },
    get tempProjectDir(): string {
      if (!_tempProjectDir) {
        throw new Error(
          'tempProjectDir accessed before beforeEach hook ran! ' +
            'Do not access tempProjectDir at the top level of your test. ' +
            'Access it inside beforeEach/it blocks only.'
        );
      }
      return _tempProjectDir;
    },
  };

  // Reset persistence and provider registry before each test
  beforeEach(async () => {
    resetPersistence();
    ProviderRegistry.clearInstance();

    // Create temp project directory
    _tempProjectDir = await fs.mkdtemp(join(tmpdir(), 'lace-project-'));
  });

  // Clear provider registry after each test to ensure isolation
  afterEach(async () => {
    ProviderRegistry.clearInstance();

    // Clean up temp project directory
    if (_tempProjectDir) {
      try {
        await fs.rm(_tempProjectDir, { recursive: true, force: true, maxRetries: 3 });
      } catch (error) {
        console.warn(`Failed to clean up temp project directory ${_tempProjectDir}:`, error);
      }
      _tempProjectDir = '';
    }
  });

  return context;
}
