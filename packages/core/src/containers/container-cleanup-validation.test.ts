// ABOUTME: Validation test for container cleanup behavior
// ABOUTME: Ensures containers are fully removed after test completion

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppleContainerRuntime } from '~/containers/apple-container';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import type { ContainerConfig } from '~/containers/types';
import { execFile } from 'child_process';
import { promisify } from 'util';

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

  beforeEach(() => {
    runtime = new AppleContainerRuntime();
    testDir = join(tmpdir(), `container-cleanup-validation-${uuidv4()}`);
    mkdirSync(testDir, { recursive: true });
    createdContainers = [];
  });

  afterEach(async () => {
    // Clean up all created containers
    for (const containerId of createdContainers) {
      try {
        await runtime.stop(containerId, 3000);
        await runtime.remove(containerId);
      } catch (error) {
        console.warn(`Cleanup: Failed to remove container ${containerId}:`, error);
        // Force remove via container CLI as fallback
        try {
          await execFileAsync('container', ['rm', '-f', containerId], { timeout: 2000 });
        } catch {
          // Best effort
        }
      }
    }

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 20000); // Generous timeout for cleanup

  it('should fully remove container after stop and remove', async () => {
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

    // Stop and remove
    await runtime.stop(containerId, 5000);
    await runtime.remove(containerId);

    // Verify container is completely gone from system
    expect(await containerExists(containerId)).toBe(false);

    // Remove from tracking since we cleaned it successfully
    createdContainers = createdContainers.filter((id) => id !== containerId);
  }, 30000); // Longer timeout for container operations

  it('should handle cleanup even if container is already stopped', async () => {
    const config: ContainerConfig = {
      id: 'cleanup-stopped-test',
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
    await runtime.stop(containerId, 5000);

    // Container is already stopped - remove should still work
    await expect(runtime.remove(containerId)).resolves.not.toThrow();

    // Verify fully removed
    expect(await containerExists(containerId)).toBe(false);

    createdContainers = createdContainers.filter((id) => id !== containerId);
  }, 30000);

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
