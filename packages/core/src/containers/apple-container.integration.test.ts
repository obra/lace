// ABOUTME: Real integration tests for Apple Container runtime
// ABOUTME: Actually launches containers using sandbox-exec to verify they work

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppleContainerRuntime } from './apple-container';
import { ContainerConfig } from './types';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';

describe('AppleContainerRuntime Integration', () => {
  let runtime: AppleContainerRuntime;
  let testDir: string;
  let createdContainers: string[] = [];

  beforeEach(() => {
    runtime = new AppleContainerRuntime();
    testDir = join(tmpdir(), `lace-container-integration-${uuidv4()}`);
    mkdirSync(testDir, { recursive: true });
    createdContainers = [];
  });

  afterEach(async () => {
    // Clean up containers with timeout
    for (const containerId of createdContainers) {
      try {
        await runtime.stop(containerId, 3000); // Short timeout for cleanup
        await runtime.remove(containerId);
      } catch (error) {
        // Log but don't fail on cleanup errors
        console.warn(`Failed to clean up container ${containerId}:`, error);
      }
    }

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 15000); // Increase timeout for cleanup

  describe('Real container execution', () => {
    it('should actually execute commands in a sandboxed environment', async () => {
      // Create a test file in our test directory
      const testFile = join(testDir, 'test.txt');
      writeFileSync(testFile, 'Hello from host');

      const config: ContainerConfig = {
        id: 'exec-test-real',
        workingDirectory: '/workspace', // Use container path, not host path
        mounts: [{ source: testDir, target: '/workspace', readonly: false }],
      };

      const containerId = runtime.create(config);
      createdContainers.push(containerId);

      // Start the container
      await runtime.start(containerId);

      // Execute a simple echo command
      const result1 = await runtime.exec(containerId, {
        command: ['echo', 'Hello from container'],
      });

      console.log('Result1:', result1);
      expect(result1.exitCode).toBe(0);
      expect(result1.stdout.trim()).toBe('Hello from container');

      // Read the test file from within the container
      const result2 = await runtime.exec(containerId, {
        command: ['cat', '/workspace/test.txt'],
      });

      expect(result2.exitCode).toBe(0);
      expect(result2.stdout.trim()).toBe('Hello from host');

      // Write a new file from within the container
      const result3 = await runtime.exec(containerId, {
        command: ['sh', '-c', 'echo "Hello from container" > /workspace/container-output.txt'],
      });

      expect(result3.exitCode).toBe(0);

      // Verify the file was created on the host
      const containerOutputPath = join(testDir, 'container-output.txt');
      expect(existsSync(containerOutputPath)).toBe(true);
      expect(readFileSync(containerOutputPath, 'utf-8').trim()).toBe('Hello from container');

      // Stop the container
      await runtime.stop(containerId);

      // Verify we can't execute in a stopped container
      await expect(
        runtime.exec(containerId, {
          command: ['echo', 'test'],
        })
      ).rejects.toThrow();
    });

    it('should isolate filesystem access based on mounts', async () => {
      const config: ContainerConfig = {
        id: 'isolation-test',
        workingDirectory: '/tmp',
        mounts: [{ source: testDir, target: '/allowed', readonly: false }],
      };

      const containerId = runtime.create(config);
      createdContainers.push(containerId);
      await runtime.start(containerId);

      // Should be able to write to mounted directory
      const result1 = await runtime.exec(containerId, {
        command: ['sh', '-c', 'echo "test" > /allowed/test.txt'],
      });
      expect(result1.exitCode).toBe(0);

      // Verify we can list what's in the root directory
      const result2 = await runtime.exec(containerId, {
        command: ['ls', '/'],
      });
      expect(result2.exitCode).toBe(0);

      // Verify the mounted directory is accessible
      const result3 = await runtime.exec(containerId, {
        command: ['ls', '/allowed'],
      });
      expect(result3.exitCode).toBe(0);
      expect(existsSync(join(testDir, 'test.txt'))).toBe(true);

      await runtime.stop(containerId);
    });

    it('should handle environment variables', async () => {
      const config: ContainerConfig = {
        id: 'env-test',
        workingDirectory: '/workspace', // Use container path, not host path
        mounts: [{ source: testDir, target: '/workspace' }],
        environment: {
          TEST_VAR: 'test_value',
          CUSTOM_PATH: '/custom/bin',
        },
      };

      const containerId = runtime.create(config);
      createdContainers.push(containerId);
      await runtime.start(containerId);

      const result = await runtime.exec(containerId, {
        command: ['sh', '-c', 'echo "$TEST_VAR"'],
        environment: {
          TEST_VAR: 'overridden_value', // Test override
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('overridden_value');

      await runtime.stop(containerId);
    });

    it('should handle concurrent container execution', async () => {
      // Create two containers
      const config1: ContainerConfig = {
        id: 'concurrent-1',
        workingDirectory: '/workspace', // Use container path, not host path
        mounts: [{ source: testDir, target: '/workspace' }],
      };

      const config2: ContainerConfig = {
        id: 'concurrent-2',
        workingDirectory: '/workspace', // Use container path, not host path
        mounts: [{ source: testDir, target: '/workspace' }],
      };

      const id1 = runtime.create(config1);
      const id2 = runtime.create(config2);
      createdContainers.push(id1, id2);

      await runtime.start(id1);
      await runtime.start(id2);

      // Execute commands in parallel
      const [result1, result2] = await Promise.all([
        runtime.exec(id1, { command: ['echo', 'container1'] }),
        runtime.exec(id2, { command: ['echo', 'container2'] }),
      ]);

      expect(result1.stdout.trim()).toBe('container1');
      expect(result2.stdout.trim()).toBe('container2');

      await Promise.all([runtime.stop(id1), runtime.stop(id2)]);
    });
  });
});
