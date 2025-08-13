// ABOUTME: Utility for managing isolated LACE_DIR environments in E2E tests
// ABOUTME: Provides temp directory setup, cleanup, and environment variable management

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Creates an isolated LACE_DIR environment for a test and ensures proper cleanup
 * @param prefix - Prefix for the temporary directory name
 * @param testFn - Test function to execute with the isolated environment
 * @returns Promise that resolves when test completes and cleanup is done
 */
export async function withTempLaceDir<T>(
  prefix: string,
  testFn: (tempDir: string) => Promise<T>
): Promise<T> {
  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), prefix)
  );
  const originalLaceDir = process.env.LACE_DIR;
  
  // Set isolated LACE_DIR
  process.env.LACE_DIR = tempDir;
  
  try {
    return await testFn(tempDir);
  } finally {
    // Always restore original environment
    if (originalLaceDir !== undefined) {
      process.env.LACE_DIR = originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }
    
    // Clean up temp directory
    try {
      await fs.promises.stat(tempDir);
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Directory already removed or doesn't exist - ignore
    }
  }
}