// ABOUTME: Integration tests for Apple Container runtime implementation
// ABOUTME: Tests macOS-specific container functionality and sandbox profiles

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppleContainerRuntime } from './apple-container';
import { ContainerConfig, ContainerError } from './types';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';

// The Apple `container` runtime only exists on macOS; on Linux (CI, embedder
// hosts) `container system start` fails. Guard the whole suite to darwin —
// mirrors apple-container.integration.test.ts's APPLE_CONTAINER_AVAILABLE gate.
const isDarwin = process.platform === 'darwin';

describe.skipIf(!isDarwin)('AppleContainerRuntime', () => {
  let runtime: AppleContainerRuntime;
  let testDir: string;
  let createdContainers: string[] = [];

  beforeEach(() => {
    runtime = new AppleContainerRuntime();
    testDir = join(tmpdir(), `lace-container-test-${uuidv4()}`);
    mkdirSync(testDir, { recursive: true });
    createdContainers = [];
  });

  afterEach(async () => {
    // Clean up any created containers
    for (const containerId of createdContainers) {
      try {
        await runtime.remove(containerId);
      } catch {
        // Ignore errors during cleanup
      }
    }

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('create', () => {
    it('should create a container with generated ID if not provided', () => {
      const config: ContainerConfig = {
        id: '',
        image: 'mcr.microsoft.com/devcontainers/base:ubuntu',
        workingDirectory: testDir,
        mounts: [{ source: testDir, target: '/workspace', readonly: false }],
      };

      const containerId = runtime.create(config);
      createdContainers.push(containerId);

      expect(containerId).toBeTruthy();
      expect(containerId.length).toBeGreaterThan(0);

      const info = runtime.inspect(containerId);
      expect(info.state).toBe('created');
    });

    it('should use provided container ID with unique suffix', () => {
      const config: ContainerConfig = {
        id: 'test-container-123',
        image: 'mcr.microsoft.com/devcontainers/base:ubuntu',
        workingDirectory: '/workspace',
        mounts: [],
      };

      const containerId = runtime.create(config);
      createdContainers.push(containerId);

      // Container ID should start with the provided ID but have a unique suffix
      expect(containerId).toMatch(/^test-container-123-[a-f0-9]{8}$/);
    });
  });

  describe('lifecycle', () => {
    it('should transition through states correctly', async () => {
      const config: ContainerConfig = {
        id: 'lifecycle-test',
        image: 'mcr.microsoft.com/devcontainers/base:ubuntu',
        workingDirectory: testDir,
        mounts: [{ source: testDir, target: '/workspace' }],
      };

      const containerId = runtime.create(config);
      createdContainers.push(containerId);

      // Created state
      const info = await runtime.inspect(containerId);
      expect(info.state).toBe('created');

      // Skip start/stop for unit tests (requires real sandbox-exec)
      // These would be tested in integration tests

      // Remove
      await runtime.remove(containerId);
      expect(() => runtime.inspect(containerId)).toThrow();
      createdContainers = createdContainers.filter((id) => id !== containerId);
    });
  });

  describe('exec', () => {
    it('should throw error when container is not running', async () => {
      const config: ContainerConfig = {
        id: 'exec-test',
        image: 'mcr.microsoft.com/devcontainers/base:ubuntu',
        workingDirectory: testDir,
        mounts: [],
      };

      const containerId = runtime.create(config);
      createdContainers.push(containerId);

      await expect(
        runtime.exec(containerId, {
          command: ['echo', 'test'],
        })
      ).rejects.toThrow(ContainerError);
    });
  });

  describe('list', () => {
    it('should list all created containers', async () => {
      const containers = await runtime.list();
      const initialCount = containers.length;

      const config1: ContainerConfig = {
        id: 'list-test-1',
        image: 'mcr.microsoft.com/devcontainers/base:ubuntu',
        workingDirectory: '/workspace',
        mounts: [],
      };
      const config2: ContainerConfig = {
        id: 'list-test-2',
        image: 'mcr.microsoft.com/devcontainers/base:ubuntu',
        workingDirectory: '/workspace',
        mounts: [],
      };

      const id1 = runtime.create(config1);
      const id2 = runtime.create(config2);
      createdContainers.push(id1, id2);

      const newContainers = await runtime.list();
      expect(newContainers.length).toBe(initialCount + 2);

      const ids = newContainers.map((c) => c.id);
      // Check that IDs start with our provided IDs (they have unique suffixes now)
      expect(ids.some((id) => id.startsWith('list-test-1-'))).toBe(true);
      expect(ids.some((id) => id.startsWith('list-test-2-'))).toBe(true);
    });
  });
});
