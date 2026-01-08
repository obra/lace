// ABOUTME: Shared test setup for web package tests
// ABOUTME: Provides unified setup that handles temp LACE_DIR and persistence automatically

import { beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface TempLaceDirContext {
  tempDir: string;
  originalLaceDir: string | undefined;
}

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
 * @returns WebTestContext with tempDir (LACE_DIR) and tempProjectDir (for projects)
 */
export function setupWebTest(): WebTestContext {
  const originalLaceDir = process.env.LACE_DIR;

  let _tempLaceDir: string = '';
  let _tempProjectDir: string = '';

  const context: WebTestContext = {
    get tempDir(): string {
      if (!_tempLaceDir) {
        throw new Error(
          'tempDir accessed before beforeEach hook ran! ' +
            'Do not access tempDir at the top level of your test. ' +
            'Access it inside beforeEach/it blocks only.'
        );
      }
      return _tempLaceDir;
    },
    get originalLaceDir(): string | undefined {
      return originalLaceDir;
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

  // Reset persistence and create temp dirs before each test
  beforeEach(async () => {
    _tempLaceDir = await fs.mkdtemp(join(tmpdir(), 'lace-web-test-'));
    process.env.LACE_DIR = _tempLaceDir;

    // Create temp project directory
    _tempProjectDir = await fs.mkdtemp(join(tmpdir(), 'lace-project-'));
  });

  // Restore env and cleanup temp dirs after each test to ensure isolation
  afterEach(async () => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;

    if (_tempLaceDir) {
      try {
        await fs.rm(_tempLaceDir, { recursive: true, force: true, maxRetries: 3 });
      } catch (error) {
        console.warn(`Failed to clean up temp lace dir ${_tempLaceDir}:`, error);
      }
      _tempLaceDir = '';
    }

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
