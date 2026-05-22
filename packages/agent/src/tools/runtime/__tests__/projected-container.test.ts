import { PassThrough, Readable } from 'node:stream';
import { access, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ContainerLifecycleHooks, ContainerSpec } from '../../../containers/spec';
import { ProjectedContainerToolRuntime } from '../projected-container';
import { InMemoryRuntimeSecretResolver } from '../secrets';

function createFakeExecStreamHandle() {
  return {
    stdin: new PassThrough(),
    stdout: Readable.from(['ok']),
    stderr: Readable.from([]),
    wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
    kill: vi.fn(),
  };
}

function createFakeContainerManager() {
  return {
    materialize: vi.fn().mockResolvedValue({
      spec: descriptor().spec,
      containerId: 'container_123',
      state: 'running' as const,
    }),
    execStream: vi.fn().mockResolvedValue(createFakeExecStreamHandle()),
  };
}

function descriptor() {
  return {
    spec: {
      name: 'projected-runtime',
      containerId: 'container_123',
      requestedImage: 'example/app@sha256:' + 'b'.repeat(64),
      resolvedImageDigest: 'sha256:' + 'a'.repeat(64),
      imagePlatform: 'linux/arm64',
      workingDirectory: '/workspace',
      mounts: [
        {
          hostPath: '/host/repo',
          containerPath: '/workspace',
          readonly: false,
        },
      ],
    },
    cwd: '/workspace',
  };
}

function descriptorWithMount(input: { hostPath: string; readonly?: boolean }) {
  return {
    spec: {
      name: 'projected-runtime',
      containerId: 'container_123',
      requestedImage: 'example/app@sha256:' + 'b'.repeat(64),
      resolvedImageDigest: 'sha256:' + 'a'.repeat(64),
      imagePlatform: 'linux/arm64',
      workingDirectory: '/workspace',
      mounts: [
        {
          hostPath: input.hostPath,
          containerPath: '/workspace',
          readonly: input.readonly ?? false,
        },
      ],
    },
    cwd: '/workspace',
  };
}

describe('ProjectedContainerToolRuntime', () => {
  it('maps mounted container paths back to host paths', async () => {
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: createFakeContainerManager(),
      descriptor: descriptor(),
    });

    await expect(runtime.paths.resolve('/workspace/src/app.ts')).resolves.toEqual({
      original: '/workspace/src/app.ts',
      runtimePath: '/workspace/src/app.ts',
      hostPath: '/host/repo/src/app.ts',
      displayPath: '/workspace/src/app.ts',
    });
  });

  it('starts processes through the container manager', async () => {
    const manager = createFakeContainerManager();
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: descriptor(),
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], {
      cwd: runtime.cwd,
      env: { FOO: 'bar' },
    });

    expect(manager.execStream).toHaveBeenCalledWith(
      'projected-runtime',
      expect.objectContaining({
        command: ['/bin/sh', '-lc', 'echo ok'],
        workingDirectory: '/workspace',
        environment: { FOO: 'bar' },
      })
    );
  });

  it('materializes the descriptor spec before process start so explicit containerId is honored', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    projectedDescriptor.spec.env = { BASE: 'yes' };
    projectedDescriptor.spec.ports = [{ host: 7777, container: 7777 }];
    projectedDescriptor.spec.restartPolicy = 'unless-stopped';
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd });

    expect(manager.materialize).toHaveBeenCalledWith({
      name: 'projected-runtime',
      containerId: 'container_123',
      image: `example/app@${projectedDescriptor.spec.resolvedImageDigest}`,
      workingDirectory: '/workspace',
      mounts: [{ source: '/host/repo', target: '/workspace', readonly: false }],
      env: { BASE: 'yes' },
      ports: [{ host: 7777, container: 7777 }],
      restartPolicy: 'unless-stopped',
    });
    expect(manager.materialize.mock.invocationCallOrder[0]).toBeLessThan(
      manager.execStream.mock.invocationCallOrder[0]
    );
  });

  it('mounts host-provided runtime helpers read-only when helper mode is mount', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = {
      ...descriptor(),
      helper: {
        mode: 'mount' as const,
        hostPath: '/host/lace-runtime-helper',
        containerPath: '/usr/local/bin/lace-runtime-helper',
        command: ['/usr/local/bin/lace-runtime-helper'],
      },
    };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd });

    expect(manager.materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        mounts: expect.arrayContaining([
          {
            source: '/host/lace-runtime-helper',
            target: '/usr/local/bin/lace-runtime-helper',
            readonly: true,
          },
        ]),
      })
    );
  });

  it('copies host-provided runtime helpers before creating copy-mode containers', async () => {
    const helperRoot = await mkdtemp(join(tmpdir(), 'lace-helper-source-'));
    const helperPath = join(helperRoot, 'runtime-helper.js');
    await writeFile(helperPath, 'helper source', 'utf8');
    const projectedDescriptor = {
      ...descriptor(),
      helper: {
        mode: 'copy' as const,
        hostPath: helperPath,
        containerPath: '/usr/local/bin/lace-runtime-helper',
        command: ['/usr/local/bin/lace-runtime-helper'],
      },
    };
    const manager = {
      materialize: vi.fn(async (spec: ContainerSpec, hooks?: ContainerLifecycleHooks) => {
        await hooks?.beforeCreate?.();
        return {
          spec,
          containerId: 'container_123',
          state: 'running' as const,
        };
      }),
      execStream: vi.fn().mockResolvedValue(createFakeExecStreamHandle()),
    };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd });

    const spec = manager.materialize.mock.calls[0][0];
    const helperMount = spec.mounts.find(
      (mount) => mount.target === '/usr/local/bin/lace-runtime-helper'
    );
    expect(helperMount).toBeDefined();
    expect(helperMount).toMatchObject({
      readonly: true,
      target: '/usr/local/bin/lace-runtime-helper',
    });
    expect(helperMount!.source).not.toBe(helperPath);
    await expect(readFile(helperMount!.source, 'utf8')).resolves.toBe('helper source');
  });

  it('merges resolved secret env into the materialized container spec', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    projectedDescriptor.spec.env = { BASE: 'yes' };
    projectedDescriptor.spec.secretEnv = {
      API_KEY: { namespace: 'project', name: 'api-key' },
    };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
      sessionId: 'sess_secret',
      secretResolver: new InMemoryRuntimeSecretResolver({
        'project:api-key': 'resolved-secret',
      }),
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd });

    expect(manager.materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        env: { BASE: 'yes', API_KEY: 'resolved-secret' },
      })
    );
  });

  it('fails materialization with redacted secret context when no resolver is available', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    projectedDescriptor.spec.secretEnv = {
      API_KEY: { namespace: 'project', name: 'api-key' },
    };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
      sessionId: 'sess_secret',
    });

    await expect(
      runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd })
    ).rejects.toMatchObject({
      redactedReference: '[secret:project:REDACTED]',
      runtimeId: 'rt_container',
      sessionId: 'sess_secret',
    });
    expect(manager.materialize).not.toHaveBeenCalled();
  });

  it('materializes tag-requested descriptors with a digest-pinned image reference', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    projectedDescriptor.spec.requestedImage = 'registry.example.test:5000/team/app:dev';
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], { cwd: runtime.cwd });

    expect(manager.materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        image: `registry.example.test:5000/team/app@${projectedDescriptor.spec.resolvedImageDigest}`,
      })
    );
  });

  it('honors replace-mode process env without descriptor env', async () => {
    const manager = createFakeContainerManager();
    const projectedDescriptor = descriptor();
    projectedDescriptor.spec.env = { DESCRIPTOR_ONLY: 'hidden' };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: projectedDescriptor,
    });

    await runtime.process.start(['/bin/sh', '-lc', 'echo ok'], {
      cwd: runtime.cwd,
      env: { MCP_ONLY: 'visible' },
      envMode: 'replace',
    });

    expect(manager.execStream).toHaveBeenCalledWith(
      'projected-runtime',
      expect.objectContaining({
        environment: { MCP_ONLY: 'visible' },
        environmentMode: 'replace',
      })
    );
  });

  it('kills the container process when aborted while execStream is starting', async () => {
    const containerHandle = createFakeExecStreamHandle();
    let resolveExecStream!: (handle: typeof containerHandle) => void;
    const execStreamPromise = new Promise<typeof containerHandle>((resolve) => {
      resolveExecStream = resolve;
    });
    const manager = {
      materialize: vi.fn().mockResolvedValue({
        spec: descriptor().spec,
        containerId: 'container_123',
        state: 'running' as const,
      }),
      execStream: vi.fn().mockReturnValue(execStreamPromise),
    };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: descriptor(),
    });
    const abortController = new AbortController();

    const startPromise = runtime.process.start(['/bin/sh', '-lc', 'echo ok'], {
      cwd: runtime.cwd,
      signal: abortController.signal,
    });

    await vi.waitFor(() =>
      expect(manager.execStream).toHaveBeenCalledWith(
        'projected-runtime',
        expect.objectContaining({
          command: ['/bin/sh', '-lc', 'echo ok'],
          workingDirectory: '/workspace',
        })
      )
    );

    abortController.abort();
    resolveExecStream(containerHandle);

    await expect(startPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(containerHandle.kill).toHaveBeenCalledTimes(1);
  });

  it('rejects writes through readonly host mounts without mutating the host file', async () => {
    const hostRoot = await mkdtemp(join(tmpdir(), 'lace-projected-readonly-'));
    const hostFile = join(hostRoot, 'file.txt');
    await writeFile(hostFile, 'original', 'utf8');
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: createFakeContainerManager(),
      descriptor: descriptorWithMount({ hostPath: hostRoot, readonly: true }),
    });

    const path = await runtime.paths.resolve('/workspace/file.txt');

    await expect(runtime.fs.writeTextFile(path, 'updated')).rejects.toThrow(/read.?only/i);
    await expect(readFile(hostFile, 'utf8')).resolves.toBe('original');
  });

  it('rejects host fast-path reads through symlinks that escape the mount root', async () => {
    const hostRoot = await mkdtemp(join(tmpdir(), 'lace-projected-mount-'));
    const outsideRoot = await mkdtemp(join(tmpdir(), 'lace-projected-outside-'));
    const outsideFile = join(outsideRoot, 'secret.txt');
    await writeFile(outsideFile, 'outside secret', 'utf8');
    await symlink(outsideFile, join(hostRoot, 'secret-link.txt'));
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: createFakeContainerManager(),
      descriptor: descriptorWithMount({ hostPath: hostRoot }),
    });

    const path = await runtime.paths.resolve('/workspace/secret-link.txt');

    await expect(runtime.fs.readTextFile(path)).rejects.toThrow(/outside.*mount/i);
  });

  it('rejects host fast-path writes through symlinked parents that escape the mount root', async () => {
    const hostRoot = await mkdtemp(join(tmpdir(), 'lace-projected-mount-'));
    const outsideRoot = await mkdtemp(join(tmpdir(), 'lace-projected-outside-'));
    const outsideFile = join(outsideRoot, 'new.txt');
    await symlink(outsideRoot, join(hostRoot, 'outside-link'));
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: createFakeContainerManager(),
      descriptor: descriptorWithMount({ hostPath: hostRoot }),
    });

    const path = await runtime.paths.resolve('/workspace/outside-link/new.txt');

    await expect(runtime.fs.writeTextFile(path, 'leaked')).rejects.toThrow(/outside.*mount/i);
    await expect(access(outsideFile)).rejects.toThrow();
  });
});
