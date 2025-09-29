// ABOUTME: Integration tests for Apple Container runtime implementation
// ABOUTME: Tests macOS-specific container functionality and sandbox profiles

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppleContainerRuntime } from './apple-container';
import { ContainerConfig, ContainerError } from './types';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';

describe('AppleContainerRuntime', () => {
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
        workingDirectory: '/workspace',
        mounts: [],
      };

      const containerId = runtime.create(config);
      createdContainers.push(containerId);

      // Container ID should start with the provided ID but have a unique suffix
      expect(containerId).toMatch(/^test-container-123-[a-f0-9]{8}$/);
    });

    it('should register mounts correctly', () => {
      const config: ContainerConfig = {
        id: 'mount-test',
        workingDirectory: testDir,
        mounts: [
          { source: testDir, target: '/workspace', readonly: false },
          { source: '/tmp', target: '/tmp', readonly: true },
        ],
      };

      const containerId = runtime.create(config);
      createdContainers.push(containerId);

      // Test path translation
      const containerPath = runtime.translateToContainer(join(testDir, 'file.txt'), containerId);
      expect(containerPath).toBe('/workspace/file.txt');
    });
  });

  describe('lifecycle', () => {
    it('should transition through states correctly', async () => {
      const config: ContainerConfig = {
        id: 'lifecycle-test',
        workingDirectory: testDir,
        mounts: [{ source: testDir, target: '/workspace' }],
      };

      const containerId = runtime.create(config);
      createdContainers.push(containerId);

      // Created state
      let info = await runtime.inspect(containerId);
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

  describe('path translation', () => {
    it('should correctly translate paths between host and container', () => {
      const projectDir = join(testDir, 'project');
      const dataDir = join(testDir, 'data');
      mkdirSync(projectDir, { recursive: true });
      mkdirSync(dataDir, { recursive: true });

      const config: ContainerConfig = {
        id: 'path-test',
        workingDirectory: '/workspace',
        mounts: [
          { source: projectDir, target: '/workspace', readonly: false },
          { source: dataDir, target: '/data', readonly: true },
        ],
      };

      const containerId = runtime.create(config);
      createdContainers.push(containerId);

      // Host to container
      expect(runtime.translateToContainer(join(projectDir, 'src/index.ts'), containerId)).toBe(
        '/workspace/src/index.ts'
      );
      expect(runtime.translateToContainer(join(dataDir, 'config.json'), containerId)).toBe(
        '/data/config.json'
      );

      // Container to host
      expect(runtime.translateToHost('/workspace/src/index.ts', containerId)).toBe(
        join(projectDir, 'src/index.ts')
      );
      expect(runtime.translateToHost('/data/config.json', containerId)).toBe(
        join(dataDir, 'config.json')
      );

      // Unmounted paths
      expect(runtime.translateToContainer('/other/path', containerId)).toBe('/other/path');
      expect(runtime.translateToHost('/unmounted/path', containerId)).toBe('/unmounted/path');
    });
  });

  describe('list', () => {
    it('should list all created containers', async () => {
      const containers = await runtime.list();
      const initialCount = containers.length;

      const config1: ContainerConfig = {
        id: 'list-test-1',
        workingDirectory: '/workspace',
        mounts: [],
      };
      const config2: ContainerConfig = {
        id: 'list-test-2',
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
