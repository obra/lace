// ABOUTME: Validation test for container cleanup behavior
// ABOUTME: Ensures containers are fully removed after test completion

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { AppleContainerRuntime } from './apple-container';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import type { ContainerConfig } from './types';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '@lace/agent/utils/logger';

const execFileAsync = promisify(execFile);

// Helper to check if container exists in system
async function containerExists(containerId: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('container', ['list', '--format', 'json'], {
      timeout: 2000,
    });
    const containers = JSON.parse(stdout || '[]') as Array<{ configuration?: { id?: string } }>;
    return containers.some((c) => c.configuration?.id === containerId);
  } catch {
    return false;
  }
}

describe.skipIf(process.platform !== 'darwin')('Container Cleanup Validation', () => {
  let runtime: AppleContainerRuntime;
  let testDir: string;
  let createdContainers: string[] = [];

  // Share runtime instance across tests - it's stateless and ensureSystemStarted() adds overhead
  beforeAll(() => {
    runtime = new AppleContainerRuntime();
    testDir = join(tmpdir(), `container-cleanup-validation-${uuidv4()}`);
    mkdirSync(testDir, { recursive: true });
  });

  beforeEach(() => {
    createdContainers = [];
  });

  afterEach(async () => {
    // Clean up all created containers
    for (const containerId of createdContainers) {
      try {
        // Use shorter timeout (1000ms) since we force-remove anyway if this fails
        await runtime.stop(containerId, 1000);
        await runtime.remove(containerId);
      } catch (error) {
        logger.warn('Cleanup: Failed to remove container', {
          containerId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Force remove via container CLI as fallback
        try {
          await execFileAsync('container', ['delete', '--force', containerId], { timeout: 2000 });
        } catch {
          // Best effort
        }
      }
    }
  }, 20000); // Generous timeout for cleanup

  afterAll(() => {
    // Clean up test directory after all tests
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  // Combined test: verifies stop, double-stop handling, and remove in a single container lifecycle
  // This saves ~6 seconds by avoiding a redundant container start/stop cycle
  it('should stop running container, handle already-stopped state, and fully remove', async () => {
    const config: ContainerConfig = {
      id: 'cleanup-validation-test',
      workingDirectory: '/workspace',
      mounts: [
        {
          source: testDir,
          target: '/workspace',
        },
      ],
      environment: {
        TEST_VAR: 'test-value',
      },
    };

    // Create and start container
    const containerId = runtime.create(config);
    createdContainers.push(containerId);

    await runtime.start(containerId);

    // Verify container is running
    expect(await containerExists(containerId)).toBe(true);

    // Stop the running container
    await runtime.stop(containerId, 5000);

    // Verify stop is idempotent - stopping again should not throw
    await expect(runtime.stop(containerId, 5000)).resolves.not.toThrow();

    // Remove should work on an already-stopped container
    await expect(runtime.remove(containerId)).resolves.not.toThrow();

    // Verify container is completely gone from system
    expect(await containerExists(containerId)).toBe(false);

    // Remove from tracking since we cleaned it successfully
    createdContainers = createdContainers.filter((id) => id !== containerId);
  }, 30000); // Longer timeout for container operations

  it('should handle cleanup when container fails to start', async () => {
    // Create container but don't start it
    const config: ContainerConfig = {
      id: 'cleanup-never-started',
      workingDirectory: '/workspace',
      mounts: [
        {
          source: testDir,
          target: '/workspace',
        },
      ],
    };

    const containerId = runtime.create(config);
    createdContainers.push(containerId);

    // Don't start - container is in 'created' state

    // Remove should still work
    await expect(runtime.remove(containerId)).resolves.not.toThrow();

    // Verify not in system
    expect(await containerExists(containerId)).toBe(false);

    createdContainers = createdContainers.filter((id) => id !== containerId);
  }, 30000);

  it('should remove container even if stop times out', async () => {
    const config: ContainerConfig = {
      id: 'cleanup-timeout-test',
      workingDirectory: '/workspace',
      mounts: [
        {
          source: testDir,
          target: '/workspace',
        },
      ],
    };

    const containerId = runtime.create(config);
    createdContainers.push(containerId);

    await runtime.start(containerId);

    // Try stop with very short timeout (might timeout)
    try {
      await runtime.stop(containerId, 500); // Half second - may timeout
    } catch {
      // Stop may have timed out, but remove should still work
    }

    // Remove with force should clean up
    await runtime.remove(containerId);

    // Verify fully removed
    expect(await containerExists(containerId)).toBe(false);

    createdContainers = createdContainers.filter((id) => id !== containerId);
  }, 30000);
});
