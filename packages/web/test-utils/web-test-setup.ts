// ABOUTME: Shared test setup for web package tests
// ABOUTME: Provides unified setup that handles temp LACE_DIR and persistence automatically

import { beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface TempLaceDirContext {
  tempDir: string;
  tempWebDir: string;
  originalLaceDir: string | undefined;
  originalLaceWebDir: string | undefined;
  originalTestProviderEnv: string | undefined;
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
  const originalLaceWebDir = process.env.LACE_WEB_DIR;
  const originalTestProviderEnv = process.env.LACE_AGENT_TEST_PROVIDER;

  let _tempLaceDir: string = '';
  let _tempWebDir: string = '';
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
    get tempWebDir(): string {
      if (!_tempWebDir) {
        throw new Error(
          'tempWebDir accessed before beforeEach hook ran! ' +
            'Do not access tempWebDir at the top level of your test. ' +
            'Access it inside beforeEach/it blocks only.'
        );
      }
      return _tempWebDir;
    },
    get originalLaceDir(): string | undefined {
      return originalLaceDir;
    },
    get originalLaceWebDir(): string | undefined {
      return originalLaceWebDir;
    },
    get originalTestProviderEnv(): string | undefined {
      return originalTestProviderEnv;
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

    _tempWebDir = await fs.mkdtemp(join(tmpdir(), 'lace-web-data-test-'));
    process.env.LACE_WEB_DIR = _tempWebDir;

    // Avoid provider network flakiness in web tests by using the agent's test provider.
    process.env.LACE_AGENT_TEST_PROVIDER = '1';

    // Create temp project directory
    _tempProjectDir = await fs.mkdtemp(join(tmpdir(), 'lace-project-'));
  });

  // Restore env and cleanup temp dirs after each test to ensure isolation
  afterEach(async () => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;

    if (originalLaceWebDir === undefined) delete process.env.LACE_WEB_DIR;
    else process.env.LACE_WEB_DIR = originalLaceWebDir;

    if (originalTestProviderEnv === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
    else process.env.LACE_AGENT_TEST_PROVIDER = originalTestProviderEnv;

    if (_tempLaceDir) {
      try {
        await fs.rm(_tempLaceDir, { recursive: true, force: true, maxRetries: 3 });
      } catch (error) {
        console.warn(`Failed to clean up temp lace dir ${_tempLaceDir}:`, error);
      }
      _tempLaceDir = '';
    }

    if (_tempWebDir) {
      try {
        await fs.rm(_tempWebDir, { recursive: true, force: true, maxRetries: 3 });
      } catch (error) {
        console.warn(`Failed to clean up temp web data dir ${_tempWebDir}:`, error);
      }
      _tempWebDir = '';
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
