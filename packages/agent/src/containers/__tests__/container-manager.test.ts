// ABOUTME: Unit tests for ContainerManager — spec → container materialization
// ABOUTME: Uses in-memory MockContainerRuntime; covers idempotency, hooks, reaping

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BaseContainerRuntime } from '../runtime';
import {
  ContainerNotFoundError,
  type ContainerConfig,
  type ContainerInfo,
  type ExecOptions,
  type ExecResult,
  type ExecStreamHandle,
  type ExecStreamOptions,
} from '../types';
import { ContainerManager } from '../container-manager';
import type { ContainerSpec } from '../spec';

class MockContainerRuntime extends BaseContainerRuntime {
  public readonly callLog: string[] = [];
  public execStreamImpl: ((id: string, opts: ExecStreamOptions) => ExecStreamHandle) | null = null;

  create(config: ContainerConfig): string {
    const containerId = config.id ?? `mock-${Math.random().toString(36).slice(2)}`;
    this.callLog.push(`create:${containerId}`);
    const info: ContainerInfo = { id: containerId, state: 'created' };
    this.containers.set(containerId, info);
    this.registerMounts(containerId, config);
    return containerId;
  }

  async start(containerId: string): Promise<void> {
    this.callLog.push(`start:${containerId}`);
    const info = this.containers.get(containerId);
    if (!info) throw new ContainerNotFoundError(containerId);
    info.state = 'running';
    info.startedAt = new Date();
  }

  async stop(containerId: string): Promise<void> {
    this.callLog.push(`stop:${containerId}`);
    const info = this.containers.get(containerId);
    if (!info) throw new ContainerNotFoundError(containerId);
    this.updateContainerState(containerId, 'stopped');
  }

  async remove(containerId: string): Promise<void> {
    this.callLog.push(`remove:${containerId}`);
    if (!this.containers.has(containerId)) {
      throw new ContainerNotFoundError(containerId);
    }
    this.containers.delete(containerId);
    this.unregisterMounts(containerId);
  }

  async exec(containerId: string, _options: ExecOptions): Promise<ExecResult> {
    const info = this.containers.get(containerId);
    if (!info) throw new ContainerNotFoundError(containerId);
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  execStream(containerId: string, options: ExecStreamOptions): Promise<ExecStreamHandle> {
    this.callLog.push(`execStream:${containerId}:${options.command.join(' ')}`);
    if (this.execStreamImpl) {
      return Promise.resolve(this.execStreamImpl(containerId, options));
    }
    throw new Error('execStreamImpl not set');
  }

  /** test helper: directly create-then-stop to simulate a leftover stopped container */
  async seedStopped(containerId: string): Promise<void> {
    this.create({
      id: containerId,
      image: 'test:latest',
      workingDirectory: '/x',
      mounts: [],
    });
    await this.start(containerId);
    await this.stop(containerId);
    // clear log so tests can inspect only manager-driven calls
    this.callLog.length = 0;
  }
}

const baseSpec: ContainerSpec = {
  name: 'sess1-worker',
  image: 'node:20',
  workingDirectory: '/lace',
  mounts: [{ source: '/host/work', target: '/lace/work', readonly: false }],
  env: { FOO: 'bar' },
};

describe('ContainerManager', () => {
  let runtime: MockContainerRuntime;
  let manager: ContainerManager;

  beforeEach(() => {
    runtime = new MockContainerRuntime();
    manager = new ContainerManager(runtime);
  });

  describe('materialize', () => {
    it('creates and starts a new container with lace- prefixed id', async () => {
      const handle = await manager.materialize(baseSpec);

      expect(handle.containerId).toBe('lace-sess1-worker');
      expect(handle.state).toBe('running');
      expect(handle.spec).toBe(baseSpec);
      expect(runtime.callLog).toEqual(['create:lace-sess1-worker', 'start:lace-sess1-worker']);
    });

    it('passes spec fields through to ContainerConfig', async () => {
      const createSpy = vi.spyOn(runtime, 'create');
      await manager.materialize(baseSpec);

      expect(createSpy).toHaveBeenCalledWith({
        id: 'lace-sess1-worker',
        name: 'sess1-worker',
        image: 'node:20',
        workingDirectory: '/lace',
        mounts: baseSpec.mounts,
        environment: { FOO: 'bar' },
      });
    });

    it('propagates spec.image into ContainerConfig (kata #53)', async () => {
      // Regression: ContainerManager used to drop spec.image, so every container
      // booted whatever default image the runtime carried. Lock the wiring down.
      const createSpy = vi.spyOn(runtime, 'create');
      const customSpec: ContainerSpec = { ...baseSpec, name: 'persona', image: 'node:24-bookworm' };

      await manager.materialize(customSpec);

      const [config] = createSpy.mock.calls[0] as [ContainerConfig];
      expect(config.image).toBe('node:24-bookworm');
    });

    it('is idempotent: second materialize with same name returns existing without recreating', async () => {
      const first = await manager.materialize(baseSpec);
      runtime.callLog.length = 0;

      const second = await manager.materialize(baseSpec);

      expect(second.containerId).toBe(first.containerId);
      expect(second.state).toBe('running');
      expect(runtime.callLog).toEqual([]);
    });

    it('starts a stopped container instead of creating a new one', async () => {
      await runtime.seedStopped('lace-sess1-worker');

      const handle = await manager.materialize(baseSpec);

      expect(handle.state).toBe('running');
      expect(runtime.callLog).toEqual(['start:lace-sess1-worker']);
    });

    it('runs beforeCreate hook before runtime.create', async () => {
      const events: string[] = [];
      const beforeCreate = vi.fn(async () => {
        events.push('hook');
      });
      vi.spyOn(runtime, 'create').mockImplementation((cfg) => {
        events.push('create');
        const id = cfg.id ?? 'x';
        runtime['containers'].set(id, { id, state: 'created' });
        return id;
      });

      await manager.materialize(baseSpec, { beforeCreate });

      expect(beforeCreate).toHaveBeenCalledOnce();
      expect(events).toEqual(['hook', 'create']);
    });

    it('skips beforeCreate when container already exists', async () => {
      await manager.materialize(baseSpec);
      const beforeCreate = vi.fn(async () => {});

      await manager.materialize(baseSpec, { beforeCreate });

      expect(beforeCreate).not.toHaveBeenCalled();
    });
  });

  describe('inspect', () => {
    it('returns null when no container exists', async () => {
      const handle = await manager.inspect('does-not-exist');
      expect(handle).toBeNull();
    });

    it('returns handle with cached spec when container exists', async () => {
      await manager.materialize(baseSpec);

      const handle = await manager.inspect('sess1-worker');

      expect(handle).not.toBeNull();
      expect(handle?.containerId).toBe('lace-sess1-worker');
      expect(handle?.state).toBe('running');
      expect(handle?.spec).toBe(baseSpec);
    });

    it('returns null if runtime has the container but manager has no cached spec', async () => {
      // simulates resurrected container after restart — manager has not materialized in this process
      runtime.create({
        id: 'lace-orphan',
        image: 'test:latest',
        workingDirectory: '/x',
        mounts: [],
      });

      const handle = await manager.inspect('orphan');

      expect(handle).toBeNull();
    });
  });

  describe('destroy', () => {
    it('stops + removes container and runs afterDestroy after removal', async () => {
      await manager.materialize(baseSpec);
      runtime.callLog.length = 0;
      const events: string[] = [];
      const afterDestroy = vi.fn(async () => {
        events.push('hook');
      });

      await manager.destroy('sess1-worker', { afterDestroy });

      expect(runtime.callLog).toEqual(['stop:lace-sess1-worker', 'remove:lace-sess1-worker']);
      expect(afterDestroy).toHaveBeenCalledOnce();
      // hook fires AFTER stop+remove
      expect(events).toEqual(['hook']);
    });

    it('does not throw when container is already gone and still runs afterDestroy', async () => {
      // Design choice: afterDestroy is a cleanup hook (e.g. remove tempdir).
      // Whether the container existed or not, the caller asked us to destroy
      // by name — hook still runs.
      const afterDestroy = vi.fn(async () => {});

      await expect(manager.destroy('ghost', { afterDestroy })).resolves.toBeUndefined();
      expect(afterDestroy).toHaveBeenCalledOnce();
    });

    it('clears cached spec so subsequent inspect returns null', async () => {
      await manager.materialize(baseSpec);
      await manager.destroy('sess1-worker');

      expect(await manager.inspect('sess1-worker')).toBeNull();
    });
  });

  describe('execStream', () => {
    it('delegates to runtime with resolved container id', async () => {
      const fakeHandle = {} as ExecStreamHandle;
      runtime.execStreamImpl = () => fakeHandle;
      const spy = vi.spyOn(runtime, 'execStream');

      const result = await manager.execStream('sess1-worker', { command: ['echo', 'hi'] });

      expect(spy).toHaveBeenCalledWith('lace-sess1-worker', { command: ['echo', 'hi'] });
      expect(result).toBe(fakeHandle);
    });
  });

  describe('reapOrphans', () => {
    it('destroys containers matching prefix that are not in liveSpecNames', async () => {
      // three lace-sess1-* containers, two live + one orphan
      runtime.create({
        id: 'lace-sess1-alpha',
        image: 'test:latest',
        workingDirectory: '/x',
        mounts: [],
      });
      runtime.create({
        id: 'lace-sess1-beta',
        image: 'test:latest',
        workingDirectory: '/x',
        mounts: [],
      });
      runtime.create({
        id: 'lace-sess1-zombie',
        image: 'test:latest',
        workingDirectory: '/x',
        mounts: [],
      });
      // unrelated prefix — must be left alone
      runtime.create({
        id: 'lace-other-x',
        image: 'test:latest',
        workingDirectory: '/x',
        mounts: [],
      });
      // non-lace id — must be ignored entirely
      runtime.create({
        id: 'docker-default',
        image: 'test:latest',
        workingDirectory: '/x',
        mounts: [],
      });
      runtime.callLog.length = 0;

      const result = await manager.reapOrphans('sess1-', new Set(['sess1-alpha', 'sess1-beta']));

      expect(result.reaped).toEqual(['sess1-zombie']);
      expect(runtime.callLog).toContain('stop:lace-sess1-zombie');
      expect(runtime.callLog).toContain('remove:lace-sess1-zombie');
      expect(runtime.callLog).not.toContain('remove:lace-sess1-alpha');
      expect(runtime.callLog).not.toContain('remove:lace-other-x');
      expect(runtime.callLog).not.toContain('remove:docker-default');
    });

    it('empty prefix reaps any lace- container not in liveSpecNames', async () => {
      runtime.create({ id: 'lace-keep', image: 'test:latest', workingDirectory: '/x', mounts: [] });
      runtime.create({ id: 'lace-drop', image: 'test:latest', workingDirectory: '/x', mounts: [] });

      const result = await manager.reapOrphans('', new Set(['keep']));

      expect(result.reaped).toEqual(['drop']);
    });

    it('continues past individual failures and reports successes', async () => {
      runtime.create({ id: 'lace-a', image: 'test:latest', workingDirectory: '/x', mounts: [] });
      runtime.create({ id: 'lace-b', image: 'test:latest', workingDirectory: '/x', mounts: [] });
      const originalStop = runtime.stop.bind(runtime);
      vi.spyOn(runtime, 'stop').mockImplementation(async (id: string) => {
        if (id === 'lace-a') throw new Error('boom');
        return originalStop(id);
      });

      const result = await manager.reapOrphans('', new Set());

      // 'a' had stop() throw but destroy() swallows it; remove still runs and succeeds
      expect(result.reaped.sort()).toEqual(['a', 'b']);
    });
  });
});
