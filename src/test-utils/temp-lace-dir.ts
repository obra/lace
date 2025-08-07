// ABOUTME: Test utilities for managing temporary LACE_DIR during tests
// ABOUTME: Provides helpers to create isolated test environments with proper cleanup

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { beforeEach, afterEach } from 'vitest';

export interface TempLaceDirContext {
  tempDir: string;
  originalLaceDir: string | undefined;
}

/**
 * Creates a temporary LACE_DIR for tests and automatically cleans it up.
 * Call this in your describe block to set up isolated test environments.
 */
export function useTempLaceDir(): TempLaceDirContext {
  const context: TempLaceDirContext = {
    tempDir: '',
    originalLaceDir: undefined,
  };

  beforeEach(async () => {
    // Create a proper temp directory
    context.tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lace-test-'));

    // Save original LACE_DIR and set it to our temp directory
    context.originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = context.tempDir;
  });

  afterEach(async () => {
    // Restore original LACE_DIR
    if (context.originalLaceDir !== undefined) {
      process.env.LACE_DIR = context.originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }

    // Clean up temp directory
    if (context.tempDir && fs.existsSync(context.tempDir)) {
      await fs.promises.rm(context.tempDir, { recursive: true, force: true });
    }
  });

  return context;
}
