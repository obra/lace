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

// per_invocation: no explicit mounts (scratch is auto-injected at /work).
// sess_pppppppp00000000 → parent short 'pppppppp'
// sess_cccccccc00000000 → child  short 'cccccccc'
const PARENT_SESSION_ID = 'sess_pppppppp00000000';
const CHILD_SESSION_ID = 'sess_cccccccc00000000';
const SCRATCH_PATH = '/tmp/test-scratch';

const containerRuntime = {
  type: 'container' as const,
  agentPlacement: 'container' as const,
  containerSharing: 'per_invocation' as const,
  image: 'devcontainer:latest',
  workingDirectory: '/workspace',
  mounts: {},
};

describe('spawnSubagent', () => {
  let fakeManager: FakeContainerManager;

  beforeEach(() => {
    fakeManager = new FakeContainerManager();
  });

  it('container persona materializes and execStreams with composed spec', async () => {
    const handle = await spawnSubagent({
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      personaContainerRuntime: containerRuntime,
      containerManager: fakeManager as unknown as ContainerManager,
      containerMounts: {},
    });

    expect(fakeManager.materialize).toHaveBeenCalledOnce();
    const spec = fakeManager.materialize.mock.calls[0][0];
    // Per-invocation name: parent8-persona-child8
    expect(spec.name).toBe('pppppppp-shell-cccccccc');
    // Auto-injected scratch mount at /work
    expect(spec.mounts).toEqual([{ source: SCRATCH_PATH, target: '/work', readonly: false }]);

    expect(fakeManager.execStream).toHaveBeenCalledOnce();
    const [specName, options] = fakeManager.execStream.mock.calls[0];
    expect(specName).toBe('pppppppp-shell-cccccccc');
    expect(options.command).toEqual(['node', '/lace/packages/agent/dist/main.js']);
    expect(options.workingDirectory).toBe('/workspace');

    expect(handle.containerExec).not.toBeNull();
    expect(handle.nativeProcess).toBeNull();
  });

  it('container persona with unknown mount fails before materialize', async () => {
    await expect(
      spawnSubagent({
        parentSessionId: PARENT_SESSION_ID,
        personaName: 'shell',
        childSessionId: CHILD_SESSION_ID,
        scratchDirHostPath: SCRATCH_PATH,
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
        parentSessionId: PARENT_SESSION_ID,
        personaName: 'shell',
        childSessionId: CHILD_SESSION_ID,
        scratchDirHostPath: SCRATCH_PATH,
        personaContainerRuntime: containerRuntime,
        containerManager: null,
        containerMounts: {},
      })
    ).rejects.toThrow(SubagentSpawnError);
  });

  it('container persona with unsafe parentSessionId rejects before materialize', async () => {
    await expect(
      spawnSubagent({
        parentSessionId: 'bad; rm -rf /',
        personaName: 'shell',
        childSessionId: CHILD_SESSION_ID,
        scratchDirHostPath: SCRATCH_PATH,
        personaContainerRuntime: containerRuntime,
        containerManager: fakeManager as unknown as ContainerManager,
        containerMounts: {},
      })
    ).rejects.toThrow(/Invalid parentSessionId/);

    expect(fakeManager.materialize).not.toHaveBeenCalled();
  });

  it('two spawns with same childSessionId produce identical spec names (resume reuses container)', async () => {
    // ContainerManager.materialize itself is idempotent by name (covered by its
    // own tests). spawnSubagent's role is to invoke it consistently so the
    // second call sees the same spec.name and reuses the existing container.
    const params = {
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      personaContainerRuntime: containerRuntime,
      containerManager: fakeManager as unknown as ContainerManager,
      containerMounts: {},
    };

    await spawnSubagent(params);
    await spawnSubagent(params);

    expect(fakeManager.materialize).toHaveBeenCalledTimes(2);
    expect(fakeManager.materialize.mock.calls[0][0].name).toBe('pppppppp-shell-cccccccc');
    expect(fakeManager.materialize.mock.calls[1][0].name).toBe('pppppppp-shell-cccccccc');
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
      parentSessionId: PARENT_SESSION_ID,
      personaName: 'shell',
      childSessionId: CHILD_SESSION_ID,
      scratchDirHostPath: SCRATCH_PATH,
      personaContainerRuntime: containerRuntime,
      containerManager: fakeManager as unknown as ContainerManager,
      containerMounts: {},
    });

    handle.kill('SIGTERM');
    expect(execKill).toHaveBeenCalledWith('SIGTERM');
  });

  it('container runtime without a personaName throws before materialize', async () => {
    await expect(
      spawnSubagent({
        parentSessionId: PARENT_SESSION_ID,
        personaName: undefined,
        childSessionId: CHILD_SESSION_ID,
        scratchDirHostPath: SCRATCH_PATH,
        personaContainerRuntime: containerRuntime,
        containerManager: fakeManager as unknown as ContainerManager,
        containerMounts: {},
      })
    ).rejects.toThrow(SubagentSpawnError);
    expect(fakeManager.materialize).not.toHaveBeenCalled();
  });

  it('persistent lifecycle materializes persistent spec and execStreams the in-container lace-agent', async () => {
    const persistentRuntime = {
      type: 'container' as const,
      agentPlacement: 'container' as const,
      containerSharing: 'persistent' as const,
      image: 'sen-box:dev',
      workingDirectory: '/home/agent',
      mounts: {},
      env: {},
    };

    const handle = await spawnSubagent({
      parentSessionId: 'sess1',
      personaName: 'box-shell',
      personaContainerRuntime: persistentRuntime,
      containerManager: fakeManager as unknown as ContainerManager,
      containerMounts: {},
    });

    expect(fakeManager.materialize).toHaveBeenCalledOnce();
    const spec = fakeManager.materialize.mock.calls[0][0];
    expect(spec.name).toBe('box-shell');
    expect(spec.containerId).toBe('sen-box-shell');
    expect(spec.restartPolicy).toBe('unless-stopped');
    expect(spec.ports).toBeUndefined();

    expect(fakeManager.execStream).toHaveBeenCalledOnce();
    const [specName, options] = fakeManager.execStream.mock.calls[0];
    expect(specName).toBe('box-shell');
    expect(options.command).toEqual(['node', '/lace/packages/agent/dist/main.js']);
    expect(options.workingDirectory).toBe('/home/agent');

    expect(handle.containerExec).not.toBeNull();
    expect(handle.nativeProcess).toBeNull();
  });

  it('persistent lifecycle without a containerManager throws', async () => {
    await expect(
      spawnSubagent({
        parentSessionId: 'sess1',
        personaName: 'sen',
        personaContainerRuntime: {
          type: 'container',
          agentPlacement: 'container',
          containerSharing: 'persistent',
          image: 'sen-box:dev',
          workingDirectory: '/home/agent',
          mounts: {},
          env: {},
        },
        containerManager: null,
        containerMounts: {},
      })
    ).rejects.toThrow(SubagentSpawnError);
  });

  it('persistent lifecycle without a personaName throws', async () => {
    await expect(
      spawnSubagent({
        parentSessionId: 'sess1',
        personaName: undefined,
        personaContainerRuntime: {
          type: 'container',
          agentPlacement: 'container',
          containerSharing: 'persistent',
          image: 'sen-box:dev',
          workingDirectory: '/home/agent',
          mounts: {},
          env: {},
        },
        containerManager: fakeManager as unknown as ContainerManager,
        containerMounts: {},
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
