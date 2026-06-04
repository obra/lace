// ABOUTME: Unit tests for the container runtime abstraction layer
// ABOUTME: Tests base runtime functionality and path translation logic

import { describe, it, expect, beforeEach } from 'vitest';
import { BaseContainerRuntime } from './runtime';
import {
  ContainerConfig,
  ContainerInfo,
  ExecOptions,
  ExecResult,
  ExecStreamOptions,
  ExecStreamHandle,
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

  execStream(_containerId: string, _options: ExecStreamOptions): Promise<ExecStreamHandle> {
    throw new Error('MockContainerRuntime.execStream not implemented');
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
        image: 'test:latest',
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
      runtime.create({
        id: 'container1',
        image: 'test:latest',
        workingDirectory: '/app',
        mounts: [],
      });
      runtime.create({
        id: 'container2',
        image: 'test:latest',
        workingDirectory: '/app',
        mounts: [],
      });

      const containers = await runtime.list();
      expect(containers).toHaveLength(2);
      expect(containers.map((c) => c.id)).toContain('container1');
      expect(containers.map((c) => c.id)).toContain('container2');
    });
  });

  describe('state management', () => {
    it('should update container state correctly', async () => {
      const containerId = await runtime.create({
        id: 'test-container',
        image: 'test:latest',
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
  });
});
