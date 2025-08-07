// ABOUTME: Temporary directory utilities for testing
// ABOUTME: Provides standard temp directory creation with automatic cleanup

import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Creates a temporary directory and registers cleanup with test framework
 * Use in beforeAll/afterAll or similar test lifecycle hooks
 */
export function createTestTempDir(prefix = 'lace-test-'): {
  getPath: () => Promise<string>;
  cleanup: () => Promise<void>;
} {
  let tempPath: string | null = null;

  const getPath = async (): Promise<string> => {
    if (!tempPath) {
      tempPath = await mkdtemp(join(tmpdir(), prefix));
    }
    return tempPath;
  };

  const cleanup = async (): Promise<void> => {
    if (tempPath) {
      try {
        await rm(tempPath, { recursive: true, force: true });
        tempPath = null;
      } catch {
        // Ignore cleanup errors
      }
    }
  };

  return { getPath, cleanup };
}