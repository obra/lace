// ABOUTME: Utility for managing isolated LACE_DIR environments in E2E tests
// ABOUTME: Uses worker-scoped isolation to prevent race conditions between concurrent tests

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { test as playwrightTest } from '@playwright/test';

// Worker-scoped storage for isolated temp directories
// Each Playwright worker gets its own LACE_DIR that persists across tests
const workerTempDirs = new Map<number, string>();

/**
 * Creates an isolated LACE_DIR environment for a test using worker-scoped isolation.
 * This prevents race conditions when tests run concurrently across multiple workers.
 *
 * @param prefix - Prefix for the temporary directory name (for debugging/identification)
 * @param testFn - Test function to execute with the isolated environment
 * @returns Promise that resolves when test completes
 */
export async function withTempLaceDir<T>(
  prefix: string,
  testFn: (tempDir: string) => Promise<T>
): Promise<T> {
  // Get current worker index from Playwright test context
  // This ensures each worker gets its own isolated directory
  const workerIndex = getWorkerIndex();

  // Get or create worker-specific temp directory
  let workerTempDir = workerTempDirs.get(workerIndex);

  if (!workerTempDir) {
    // Create worker-specific temp directory (persists across tests in this worker)
    workerTempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), `lace-e2e-worker-${workerIndex}-`)
    );

    workerTempDirs.set(workerIndex, workerTempDir);

    // Set LACE_DIR for this worker (all tests in this worker will use this)
    process.env.LACE_DIR = workerTempDir;

    console.log(`Worker ${workerIndex}: Initialized LACE_DIR=${workerTempDir}`);

    // Register cleanup when worker shuts down
    process.on('exit', () => cleanupWorkerTempDir(workerIndex));
    process.on('SIGINT', () => cleanupWorkerTempDir(workerIndex));
    process.on('SIGTERM', () => cleanupWorkerTempDir(workerIndex));
  }

  // Create test-specific subdirectory within worker temp dir
  const testTempDir = await fs.promises.mkdtemp(path.join(workerTempDir, `${prefix}-`));

  try {
    // Execute test with test-specific temp directory
    return await testFn(testTempDir);
  } finally {
    // Clean up test-specific directory (but keep worker dir)
    try {
      await fs.promises.stat(testTempDir);
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    } catch {
      // Directory already removed or doesn't exist - ignore
    }
  }
}

/**
 * Get the current Playwright worker index
 * Falls back to 0 if not in Playwright context
 */
function getWorkerIndex(): number {
  try {
    // Access Playwright test context to get worker index
    const testInfo = (playwrightTest as any).info?.();
    return testInfo?.workerIndex ?? 0;
  } catch {
    // Fallback if not in Playwright context
    return 0;
  }
}

/**
 * Clean up worker-specific temp directory
 */
async function cleanupWorkerTempDir(workerIndex: number): Promise<void> {
  const workerTempDir = workerTempDirs.get(workerIndex);

  if (workerTempDir) {
    try {
      await fs.promises.stat(workerTempDir);
      await fs.promises.rm(workerTempDir, { recursive: true, force: true });
      console.log(`Worker ${workerIndex}: Cleaned up LACE_DIR=${workerTempDir}`);
    } catch {
      // Directory already removed - ignore
    } finally {
      workerTempDirs.delete(workerIndex);
    }
  }
}
