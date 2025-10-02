// ABOUTME: Test utilities for managing temporary LACE_DIR during tests
// ABOUTME: Provides helpers to create isolated test environments with proper cleanup

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { beforeEach, afterEach } from 'vitest';

export interface TempLaceDirContext {
  readonly tempDir: string;
  originalLaceDir: string | undefined;
}

/**
 * Creates a temporary LACE_DIR for tests and automatically cleans it up.
 * Call this in your describe block to set up isolated test environments.
 */
export function useTempLaceDir(): TempLaceDirContext {
  let _tempDir: string = '';
  let _originalLaceDir: string | undefined;

  const context = {
    get tempDir(): string {
      if (!_tempDir) {
        throw new Error(
          'tempDir accessed before beforeEach hook ran! ' +
            'Do not access tempDir at the top level of your test. ' +
            'Access it inside beforeEach/it blocks only.'
        );
      }
      return _tempDir;
    },
    get originalLaceDir(): string | undefined {
      return _originalLaceDir;
    },
    set originalLaceDir(value: string | undefined) {
      _originalLaceDir = value;
    },
  };

  beforeEach(async () => {
    // Create a proper temp directory
    _tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lace-test-'));

    // Save original LACE_DIR and set it to our temp directory
    _originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = _tempDir;
  });

  afterEach(async () => {
    // Restore original LACE_DIR
    if (_originalLaceDir !== undefined) {
      process.env.LACE_DIR = _originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }

    // Clean up temp directory
    if (_tempDir && fs.existsSync(_tempDir)) {
      await fs.promises.rm(_tempDir, { recursive: true, force: true });
    }
  });

  return context;
}
