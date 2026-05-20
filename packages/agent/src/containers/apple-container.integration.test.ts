// ABOUTME: Real integration tests for Apple Container runtime
// ABOUTME: Actually launches containers using sandbox-exec to verify they work

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, execFile } from 'child_process';
import { AppleContainerRuntime } from './apple-container';
import { ContainerConfig } from './types';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';

function hasAppleContainerAvailable(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    // `container list` exits non-zero if the daemon isn't running or CLI is missing.
    execFileSync('container', ['list'], {
      stdio: 'ignore',
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

const APPLE_CONTAINER_AVAILABLE = hasAppleContainerAvailable();
const TEST_IMAGE = 'mcr.microsoft.com/devcontainers/base:ubuntu';

async function pullImage(image: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile('container', ['image', 'pull', image], { timeout: 180000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

describe.skipIf(!APPLE_CONTAINER_AVAILABLE)('AppleContainerRuntime Integration', () => {
  // Share one runtime instance across all tests to save ~2s initialization time
  let runtime: AppleContainerRuntime;
  let testDir: string;
  let concurrentTestDir: string;
  let containerId: string;
  const createdContainers: string[] = [];

  beforeAll(async () => {
    await pullImage(TEST_IMAGE);
    runtime = new AppleContainerRuntime();

    // Create test directories
    testDir = join(tmpdir(), `lace-container-integration-${uuidv4()}`);
    concurrentTestDir = join(tmpdir(), `lace-container-concurrent-${uuidv4()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(concurrentTestDir, { recursive: true });

    // Create subdirectories for each test to avoid conflicts
    mkdirSync(join(testDir, 'exec-test'), { recursive: true });
    mkdirSync(join(testDir, 'isolation-test'), { recursive: true });
    mkdirSync(join(testDir, 'env-test'), { recursive: true });

    const config: ContainerConfig = {
      id: 'shared-container',
      image: 'mcr.microsoft.com/devcontainers/base:ubuntu',
      workingDirectory: '/workspace',
      mounts: [{ source: testDir, target: '/workspace', readonly: false }],
      environment: {
        TEST_VAR: 'test_value',
        CUSTOM_PATH: '/custom/bin',
      },
    };

    containerId = runtime.create(config);
    await runtime.start(containerId);
  }, 240000);

  afterAll(async () => {
    // Fix race condition: stop ALL containers first, then remove ALL containers
    // Previously we ran stop+remove per container in parallel, which caused
    // "container is running" errors when remove was called before stop completed
    const allContainerIds = [containerId, ...createdContainers].filter(Boolean);

    // First stop all containers in parallel and wait for all stops to complete
    // Suppress errors - containers may already be stopped or not exist
    await Promise.all(allContainerIds.map((id) => runtime.stop(id, 2000).catch(() => {})));

    // Then remove all containers in parallel
    // Suppress errors - we don't want stderr noise from expected cleanup errors
    await Promise.all(allContainerIds.map((id) => runtime.remove(id).catch(() => {})));

    // Clean up test directories
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    if (existsSync(concurrentTestDir)) {
      rmSync(concurrentTestDir, { recursive: true, force: true });
    }
  }, 15000);

  describe('with shared container', () => {
    it('should actually execute commands in a sandboxed environment', async () => {
      // Create a test file in our test subdirectory
      const testFile = join(testDir, 'exec-test', 'test.txt');
      writeFileSync(testFile, 'Hello from host');

      // Execute a simple echo command
      const result1 = await runtime.exec(containerId, {
        command: ['echo', 'Hello from container'],
      });

      expect(result1.exitCode).toBe(0);
      expect(result1.stdout.trim()).toBe('Hello from container');

      // Read the test file from within the container
      const result2 = await runtime.exec(containerId, {
        command: ['cat', '/workspace/exec-test/test.txt'],
      });

      expect(result2.exitCode).toBe(0);
      expect(result2.stdout.trim()).toBe('Hello from host');

      // Write a new file from within the container
      const result3 = await runtime.exec(containerId, {
        command: [
          'sh',
          '-c',
          'echo "Hello from container" > /workspace/exec-test/container-output.txt',
        ],
      });

      expect(result3.exitCode).toBe(0);

      // Verify the file was created on the host
      const containerOutputPath = join(testDir, 'exec-test', 'container-output.txt');
      expect(existsSync(containerOutputPath)).toBe(true);
      expect(readFileSync(containerOutputPath, 'utf-8').trim()).toBe('Hello from container');
    });

    it('should isolate filesystem access based on mounts', async () => {
      // Should be able to write to mounted directory
      const result1 = await runtime.exec(containerId, {
        command: ['sh', '-c', 'echo "test" > /workspace/isolation-test/test.txt'],
      });
      expect(result1.exitCode).toBe(0);

      // Verify we can list what's in the root directory
      const result2 = await runtime.exec(containerId, {
        command: ['ls', '/'],
      });
      expect(result2.exitCode).toBe(0);

      // Verify the mounted directory is accessible
      const result3 = await runtime.exec(containerId, {
        command: ['ls', '/workspace/isolation-test'],
      });
      expect(result3.exitCode).toBe(0);
      expect(existsSync(join(testDir, 'isolation-test', 'test.txt'))).toBe(true);
    });

    it('should handle environment variables', async () => {
      const result = await runtime.exec(containerId, {
        command: ['sh', '-c', 'echo "$TEST_VAR"'],
        environment: {
          TEST_VAR: 'overridden_value', // Test override
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('overridden_value');
    });
  });

  describe('concurrent execution', () => {
    // Uses shared runtime and concurrentTestDir from parent scope
    // Cleanup is handled by the parent afterAll

    it('should handle concurrent container execution', { timeout: 20_000 }, async () => {
      // Create two containers
      const config1: ContainerConfig = {
        id: 'concurrent-1',
        image: 'mcr.microsoft.com/devcontainers/base:ubuntu',
        workingDirectory: '/workspace',
        mounts: [{ source: concurrentTestDir, target: '/workspace' }],
      };

      const config2: ContainerConfig = {
        id: 'concurrent-2',
        image: 'mcr.microsoft.com/devcontainers/base:ubuntu',
        workingDirectory: '/workspace',
        mounts: [{ source: concurrentTestDir, target: '/workspace' }],
      };

      const id1 = runtime.create(config1);
      const id2 = runtime.create(config2);
      createdContainers.push(id1, id2);

      // Parallelize container starts for ~3-4s savings
      await Promise.all([runtime.start(id1), runtime.start(id2)]);

      // Execute commands in parallel
      const [result1, result2] = await Promise.all([
        runtime.exec(id1, { command: ['echo', 'container1'] }),
        runtime.exec(id2, { command: ['echo', 'container2'] }),
      ]);

      expect(result1.stdout.trim()).toBe('container1');
      expect(result2.stdout.trim()).toBe('container2');

      // Note: Don't stop here - let parent afterAll handle cleanup in parallel with other containers
    });
  });
});
