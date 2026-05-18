// ABOUTME: Unit tests for spawnSubagent — native vs container path wiring
// ABOUTME: Uses a fake ContainerManager to assert materialize+execStream args without docker

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { spawnSubagent, SubagentSpawnError } from '@lace/agent/jobs/subagent-spawn';
import type { ContainerManager } from '@lace/agent/containers/container-manager';
import type { ContainerHandle, ContainerSpec } from '@lace/agent/containers/spec';
import type { ExecStreamHandle, ExecStreamOptions } from '@lace/agent/containers/types';

class FakeContainerManager {
  materialize = vi.fn(
    async (spec: ContainerSpec): Promise<ContainerHandle> => ({
      spec,
      containerId: `lace-${spec.name}`,
      state: 'running',
    })
  );

  execStream = vi.fn(
    async (_specName: string, _options: ExecStreamOptions): Promise<ExecStreamHandle> => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      return {
        stdin,
        stdout,
        stderr,
        wait: () => new Promise(() => undefined),
        kill: () => undefined,
      };
    }
  );
}

const containerRuntime = {
  type: 'container' as const,
  image: 'devcontainer:latest',
  workingDirectory: '/workspace',
  mounts: { scratch: '/scratch' },
};

describe('spawnSubagent', () => {
  let fakeManager: FakeContainerManager;

  beforeEach(() => {
    fakeManager = new FakeContainerManager();
  });

  it('container persona materializes and execStreams with composed spec', async () => {
    const handle = await spawnSubagent({
      parentSessionId: 'sess1',
      personaName: 'shell',
      personaContainerRuntime: containerRuntime,
      containerManager: fakeManager as unknown as ContainerManager,
      containerMounts: { scratch: { hostPath: '/host/scratch', readonly: false } },
    });

    expect(fakeManager.materialize).toHaveBeenCalledOnce();
    const spec = fakeManager.materialize.mock.calls[0][0];
    expect(spec.name).toBe('sess1-shell');
    expect(spec.mounts).toEqual([{ source: '/host/scratch', target: '/scratch', readonly: false }]);

    expect(fakeManager.execStream).toHaveBeenCalledOnce();
    const [specName, options] = fakeManager.execStream.mock.calls[0];
    expect(specName).toBe('sess1-shell');
    expect(options.command).toEqual(['node', '/lace/packages/agent/dist/main.js']);
    expect(options.workingDirectory).toBe('/workspace');

    expect(handle.containerExec).not.toBeNull();
    expect(handle.nativeProcess).toBeNull();
  });

  it('container persona with unknown mount fails before materialize', async () => {
    await expect(
      spawnSubagent({
        parentSessionId: 'sess1',
        personaName: 'shell',
        personaContainerRuntime: {
          ...containerRuntime,
          mounts: { phantom: '/phantom' },
        },
        containerManager: fakeManager as unknown as ContainerManager,
        containerMounts: {},
      })
    ).rejects.toThrow(/unknown mount 'phantom'/);

    expect(fakeManager.materialize).not.toHaveBeenCalled();
    expect(fakeManager.execStream).not.toHaveBeenCalled();
  });

  it('container persona without a containerManager surfaces unsupported-platform error', async () => {
    await expect(
      spawnSubagent({
        parentSessionId: 'sess1',
        personaName: 'shell',
        personaContainerRuntime: containerRuntime,
        containerManager: null,
        containerMounts: { scratch: { hostPath: '/host/scratch', readonly: false } },
      })
    ).rejects.toThrow(SubagentSpawnError);
  });

  it('container persona with unsafe parentSessionId rejects before materialize', async () => {
    await expect(
      spawnSubagent({
        parentSessionId: 'bad; rm -rf /',
        personaName: 'shell',
        personaContainerRuntime: containerRuntime,
        containerManager: fakeManager as unknown as ContainerManager,
        containerMounts: { scratch: { hostPath: '/host/scratch', readonly: false } },
      })
    ).rejects.toThrow(/Invalid parentSessionId/);

    expect(fakeManager.materialize).not.toHaveBeenCalled();
  });

  it('two spawns for the same persona+session call materialize twice with identical name', async () => {
    // ContainerManager.materialize itself is idempotent by name (covered by its
    // own tests). spawnSubagent's role is to invoke it consistently so the
    // second call sees the same spec.name and reuses the existing container.
    const params = {
      parentSessionId: 'sess1',
      personaName: 'shell',
      personaContainerRuntime: containerRuntime,
      containerManager: fakeManager as unknown as ContainerManager,
      containerMounts: { scratch: { hostPath: '/host/scratch', readonly: false } },
    };

    await spawnSubagent(params);
    await spawnSubagent(params);

    expect(fakeManager.materialize).toHaveBeenCalledTimes(2);
    expect(fakeManager.materialize.mock.calls[0][0].name).toBe('sess1-shell');
    expect(fakeManager.materialize.mock.calls[1][0].name).toBe('sess1-shell');
  });

  it('kill() on a container-path handle routes to the exec stream (not the container)', async () => {
    const execKill = vi.fn();
    fakeManager.execStream.mockImplementationOnce(async () => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      return {
        stdin,
        stdout,
        stderr,
        wait: () => new Promise(() => undefined),
        kill: execKill,
      };
    });

    const handle = await spawnSubagent({
      parentSessionId: 'sess1',
      personaName: 'shell',
      personaContainerRuntime: containerRuntime,
      containerManager: fakeManager as unknown as ContainerManager,
      containerMounts: { scratch: { hostPath: '/host/scratch', readonly: false } },
    });

    handle.kill('SIGTERM');
    expect(execKill).toHaveBeenCalledWith('SIGTERM');
  });

  it('container runtime without a personaName throws before materialize', async () => {
    await expect(
      spawnSubagent({
        parentSessionId: 'sess1',
        personaName: undefined,
        personaContainerRuntime: containerRuntime,
        containerManager: fakeManager as unknown as ContainerManager,
        containerMounts: { scratch: { hostPath: '/host/scratch', readonly: false } },
      })
    ).rejects.toThrow(SubagentSpawnError);
    expect(fakeManager.materialize).not.toHaveBeenCalled();
  });

  it('root persona path does not consult the container manager', async () => {
    // We do not actually spawn a real lace-agent here; spawn() will succeed but
    // the child process is killed immediately to avoid leaking subprocesses.
    const handle = await spawnSubagent({
      parentSessionId: 'sess1',
      personaName: 'librarian',
      personaContainerRuntime: undefined,
      containerManager: fakeManager as unknown as ContainerManager,
      containerMounts: {},
    });

    try {
      expect(fakeManager.materialize).not.toHaveBeenCalled();
      expect(fakeManager.execStream).not.toHaveBeenCalled();
      expect(handle.nativeProcess).not.toBeNull();
      expect(handle.containerExec).toBeNull();
    } finally {
      handle.kill('SIGKILL');
    }
  });
});
