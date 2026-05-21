import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { ProjectedContainerToolRuntime } from '../projected-container';

function createFakeContainerManager() {
  return {
    execStream: vi.fn().mockResolvedValue({
      stdin: new PassThrough(),
      stdout: Readable.from(['ok']),
      stderr: Readable.from([]),
      wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
      kill: vi.fn(),
    }),
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
      'container_123',
      expect.objectContaining({
        command: ['/bin/sh', '-lc', 'echo ok'],
        workingDirectory: '/workspace',
        environment: { FOO: 'bar' },
      })
    );
  });
});
