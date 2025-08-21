// ABOUTME: MSW setup for Playwright tests with isolated test environments
// ABOUTME: Initializes mock service worker and provides LACE_DIR isolation per worker

import { createWorkerFixture, MockServiceWorker } from 'playwright-msw';
import { test as baseTest } from '@playwright/test';
import { http } from 'msw';
import { handlers } from './handlers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface TestEnvironmentContext {
  tempDir: string;
  originalLaceDir: string | undefined;
  projectName: string;
}

// Create test fixture with MSW worker AND environment isolation
export const test = baseTest.extend<
  {
    worker: MockServiceWorker;
    http: typeof http;
  },
  { testEnv: TestEnvironmentContext }
>({
  // Worker-scoped environment isolation
  testEnv: [
    async ({}, use, testInfo) => {
      // Create worker-specific temp directory
      const workerIndex = testInfo.workerIndex;
      const tempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), `lace-e2e-worker-${workerIndex}-`)
      );

      // Save original LACE_DIR and set to our temp directory
      const originalLaceDir = process.env.LACE_DIR;
      process.env.LACE_DIR = tempDir;

      // Create unique project name for this worker
      const projectName = `E2E Test Project Worker ${workerIndex}`;

      console.log(`Worker ${workerIndex}: Using LACE_DIR=${tempDir}`);

      const context: TestEnvironmentContext = {
        tempDir,
        originalLaceDir,
        projectName,
      };

      await use(context);

      // Cleanup: restore original LACE_DIR
      if (originalLaceDir !== undefined) {
        process.env.LACE_DIR = originalLaceDir;
      } else {
        delete process.env.LACE_DIR;
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
  ],

  // Test-scoped MSW worker
  worker: createWorkerFixture(handlers),
  http,
});

// Re-export expect for convenience
export { expect } from '@playwright/test';
