// ABOUTME: Project-wide temp directory utilities for tests
// ABOUTME: Provides standard Node.js temp directories with automatic cleanup

import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Creates a temporary directory with automatic cleanup
 * Returns both the path and cleanup function
 */
export async function createTempDir(prefix = 'lace-test-'): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const tempPath = await mkdtemp(join(tmpdir(), prefix));

  const cleanup = async () => {
    try {
      await rm(tempPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors - temp directories are cleaned by OS
    }
  };

  return { path: tempPath, cleanup };
}

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

/**
 * Wrapper for tests that automatically handles temp directory lifecycle
 * Use this for simple cases where you need a temp dir for one test
 */
export async function withTempDir<T>(
  testFn: (tempPath: string) => Promise<T>,
  prefix = 'lace-test-'
): Promise<T> {
  const { path, cleanup } = await createTempDir(prefix);
  try {
    return await testFn(path);
  } finally {
    await cleanup();
  }
}
