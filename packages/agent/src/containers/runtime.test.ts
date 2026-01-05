// ABOUTME: Unit tests for the container runtime abstraction layer
// ABOUTME: Tests base runtime functionality and path translation logic

import { describe, it, expect, beforeEach } from 'vitest';
import { BaseContainerRuntime } from './runtime';
import {
  ContainerConfig,
  ContainerInfo,
  ExecOptions,
  ExecResult,
  ContainerNotFoundError,
} from './types';

// Mock implementation for testing base class functionality
class MockContainerRuntime extends BaseContainerRuntime {
  create(config: ContainerConfig): string {
    const containerId = config.id || 'mock-container-id';
    const info: ContainerInfo = {
      id: containerId,
      state: 'created',
    };
    this.containers.set(containerId, info);
    this.registerMounts(containerId, config);
    return containerId;
  }

  async start(containerId: string): Promise<void> {
    const info = this.containers.get(containerId);
    if (!info) throw new ContainerNotFoundError(containerId);
    info.state = 'running';
    info.startedAt = new Date();
  }

  async stop(containerId: string): Promise<void> {
    const info = this.containers.get(containerId);
    if (!info) throw new ContainerNotFoundError(containerId);
    this.updateContainerState(containerId, 'stopped');
  }

  async remove(containerId: string): Promise<void> {
    if (!this.containers.has(containerId)) {
      throw new ContainerNotFoundError(containerId);
    }
    this.containers.delete(containerId);
    this.unregisterMounts(containerId);
  }

  async exec(containerId: string, _options: ExecOptions): Promise<ExecResult> {
    const info = this.containers.get(containerId);
    if (!info) throw new ContainerNotFoundError(containerId);
    if (info.state !== 'running') {
      throw new Error(`Container ${containerId} is not running`);
    }
    return {
      stdout: 'mock output',
      stderr: '',
      exitCode: 0,
    };
  }
}

describe('BaseContainerRuntime', () => {
  let runtime: MockContainerRuntime;

  beforeEach(() => {
    runtime = new MockContainerRuntime();
  });

  describe('inspect', () => {
    it('should return container info when container exists', async () => {
      const config: ContainerConfig = {
        id: 'test-container',
        workingDirectory: '/app',
        mounts: [],
      };
      const containerId = runtime.create(config);

      const info = await runtime.inspect(containerId);
      expect(info.id).toBe('test-container');
      expect(info.state).toBe('created');
    });

    it('should throw ContainerNotFoundError when container does not exist', () => {
      expect(() => runtime.inspect('non-existent')).toThrow(ContainerNotFoundError);
    });
  });

  describe('list', () => {
    it('should return empty array when no containers exist', async () => {
      const containers = await runtime.list();
      expect(containers).toHaveLength(0);
    });

    it('should return all containers', async () => {
      runtime.create({ id: 'container1', workingDirectory: '/app', mounts: [] });
      runtime.create({ id: 'container2', workingDirectory: '/app', mounts: [] });

      const containers = await runtime.list();
      expect(containers).toHaveLength(2);
      expect(containers.map((c) => c.id)).toContain('container1');
      expect(containers.map((c) => c.id)).toContain('container2');
    });
  });

  describe('translateToContainer', () => {
    it('should translate host path to container path based on mounts', () => {
      const config: ContainerConfig = {
        id: 'test-container',
        workingDirectory: '/app',
        mounts: [
          { source: '/Users/test/project', target: '/workspace', readonly: false },
          { source: '/Users/test/data', target: '/data', readonly: true },
        ],
      };
      const containerId = runtime.create(config);

      const containerPath = runtime.translateToContainer(
        '/Users/test/project/src/file.ts',
        containerId
      );
      expect(containerPath).toBe('/workspace/src/file.ts');
    });

    it('should handle exact mount point paths', () => {
      const config: ContainerConfig = {
        id: 'test-container',
        workingDirectory: '/app',
        mounts: [{ source: '/Users/test/project', target: '/workspace', readonly: false }],
      };
      const containerId = runtime.create(config);

      const containerPath = runtime.translateToContainer('/Users/test/project', containerId);
      expect(containerPath).toBe('/workspace/');
    });

    it('should return original path when no mount matches', () => {
      const config: ContainerConfig = {
        id: 'test-container',
        workingDirectory: '/app',
        mounts: [{ source: '/Users/test/project', target: '/workspace', readonly: false }],
      };
      const containerId = runtime.create(config);

      const containerPath = runtime.translateToContainer('/Users/other/path', containerId);
      expect(containerPath).toBe('/Users/other/path');
    });

    it('should throw ContainerNotFoundError for non-existent container', () => {
      expect(() => runtime.translateToContainer('/path', 'non-existent')).toThrow(
        ContainerNotFoundError
      );
    });
  });

  describe('translateToHost', () => {
    it('should translate container path to host path based on mounts', () => {
      const config: ContainerConfig = {
        id: 'test-container',
        workingDirectory: '/app',
        mounts: [{ source: '/Users/test/project', target: '/workspace', readonly: false }],
      };
      const containerId = runtime.create(config);

      const hostPath = runtime.translateToHost('/workspace/src/file.ts', containerId);
      expect(hostPath).toBe('/Users/test/project/src/file.ts');
    });

    it('should handle multiple mount points correctly', () => {
      const config: ContainerConfig = {
        id: 'test-container',
        workingDirectory: '/app',
        mounts: [
          { source: '/Users/test/project', target: '/workspace', readonly: false },
          { source: '/Users/test/data', target: '/data', readonly: true },
        ],
      };
      const containerId = runtime.create(config);

      expect(runtime.translateToHost('/workspace/file1.ts', containerId)).toBe(
        '/Users/test/project/file1.ts'
      );
      expect(runtime.translateToHost('/data/file2.json', containerId)).toBe(
        '/Users/test/data/file2.json'
      );
    });

    it('should return original path when no mount matches', () => {
      const config: ContainerConfig = {
        id: 'test-container',
        workingDirectory: '/app',
        mounts: [],
      };
      const containerId = runtime.create(config);

      const hostPath = runtime.translateToHost('/unknown/path', containerId);
      expect(hostPath).toBe('/unknown/path');
    });
  });

  describe('state management', () => {
    it('should update container state correctly', async () => {
      const containerId = await runtime.create({
        id: 'test-container',
        workingDirectory: '/app',
        mounts: [],
      });

      let info = await runtime.inspect(containerId);
      expect(info.state).toBe('created');
      expect(info.startedAt).toBeUndefined();

      await runtime.start(containerId);
      info = await runtime.inspect(containerId);
      expect(info.state).toBe('running');
      expect(info.startedAt).toBeInstanceOf(Date);

      await runtime.stop(containerId);
      info = await runtime.inspect(containerId);
      expect(info.state).toBe('stopped');
      expect(info.stoppedAt).toBeInstanceOf(Date);
    });

    it('should clean up mounts when container is removed', async () => {
      const containerId = runtime.create({
        id: 'test-container',
        workingDirectory: '/app',
        mounts: [{ source: '/Users/test', target: '/workspace', readonly: false }],
      });

      // Verify mount exists
      expect(() => runtime.translateToContainer('/Users/test/file', containerId)).not.toThrow();

      await runtime.remove(containerId);

      // Verify mount is cleaned up
      expect(() => runtime.translateToContainer('/Users/test/file', containerId)).toThrow(
        ContainerNotFoundError
      );
    });
  });
});
