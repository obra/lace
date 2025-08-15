// ABOUTME: Test fixtures for isolated test environments per Playwright worker
// ABOUTME: Provides LACE_DIR isolation and cleanup using existing temp directory utilities

import { test as baseTest } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface TestEnvironmentContext {
  tempDir: string;
  originalLaceDir: string | undefined;
  originalWorkerIndex: string | undefined;
  projectName: string;
}

// Extend Playwright's base test with our environment fixture
export const test = baseTest.extend<{}, { testEnv: TestEnvironmentContext }>({
  testEnv: [
    async ({}, use, testInfo) => {
      // Create worker-specific temp directory (similar to temp-lace-dir.ts pattern)
      const workerIndex = testInfo.workerIndex;
      const tempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), `lace-e2e-worker-${workerIndex}-`)
      );

      // Save original environment and set to our worker-specific values
      const originalLaceDir = process.env.LACE_DIR;
      const originalWorkerIndex = process.env.TEST_WORKER_INDEX;
      
      process.env.LACE_DIR = tempDir;
      process.env.TEST_WORKER_INDEX = workerIndex.toString();

      // Create unique project name for this worker
      const projectName = `E2E Test Project Worker ${workerIndex}`;

      console.log(`Worker ${workerIndex}: Using LACE_DIR=${tempDir}, port=${23457 + workerIndex}`);

      const context: TestEnvironmentContext = {
        tempDir,
        originalLaceDir,
        originalWorkerIndex,
        projectName,
      };

      await use(context);

      // Cleanup: restore original environment
      if (originalLaceDir !== undefined) {
        process.env.LACE_DIR = originalLaceDir;
      } else {
        delete process.env.LACE_DIR;
      }
      
      if (originalWorkerIndex !== undefined) {
        process.env.TEST_WORKER_INDEX = originalWorkerIndex;
      } else {
        delete process.env.TEST_WORKER_INDEX;
      }

      // Cleanup: remove temp directory
      if (
        await fs.promises
          .stat(tempDir)
          .then(() => true)
          .catch(() => false)
      ) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      }

      console.log(`Worker ${workerIndex}: Cleaned up LACE_DIR=${tempDir}`);
    },
    { scope: 'worker' },
  ], // Worker scope means one instance per worker process
});

// Re-export expect for convenience
export { expect } from '@playwright/test';
