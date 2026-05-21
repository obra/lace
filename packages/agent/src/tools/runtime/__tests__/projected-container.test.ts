import { PassThrough, Readable } from 'node:stream';
import { access, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ProjectedContainerToolRuntime } from '../projected-container';

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

  it('kills the container process when aborted while execStream is starting', async () => {
    const containerHandle = createFakeExecStreamHandle();
    let resolveExecStream!: (handle: typeof containerHandle) => void;
    const execStreamPromise = new Promise<typeof containerHandle>((resolve) => {
      resolveExecStream = resolve;
    });
    const manager = {
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

    expect(manager.execStream).toHaveBeenCalledWith(
      'projected-runtime',
      expect.objectContaining({
        command: ['/bin/sh', '-lc', 'echo ok'],
        workingDirectory: '/workspace',
      })
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
