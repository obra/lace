// ABOUTME: Test fixtures for isolated test environments per Playwright worker
// ABOUTME: Provides LACE_DIR isolation and cleanup using existing temp directory utilities

import { test as baseTest } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface TestEnvironmentContext {
  tempDir: string;
  originalLaceDir: string | undefined;
  projectName: string;
}

// Extend Playwright's base test with our environment fixture
export const test = baseTest.extend<{}, { testEnv: TestEnvironmentContext }>({
  testEnv: [async (_args, use, testInfo) => {
    // Create worker-specific temp directory (similar to temp-lace-dir.ts pattern)
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
    if (fs.existsSync(tempDir)) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }

    console.log(`Worker ${workerIndex}: Cleaned up LACE_DIR=${tempDir}`);
  }, { scope: 'worker' }], // Worker scope means one instance per worker process
});

// Re-export expect for convenience
export { expect } from '@playwright/test';