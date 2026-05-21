import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { ProjectedContainerToolRuntime } from '../projected-container';

function createFakeContainerManagerWithHelper(input: {
  response: { ok: true; value: unknown } | { ok: false; error: unknown };
}) {
  return {
    execStream: vi.fn().mockResolvedValue({
      stdin: new PassThrough(),
      stdout: Readable.from([`${JSON.stringify(input.response)}\n`]),
      stderr: Readable.from([]),
      wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
      kill: vi.fn(),
    }),
  };
}

function containerDescriptorWithHelper() {
  return {
    spec: {
      name: 'projected-runtime',
      containerId: 'container_123',
      requestedImage: 'example/app@sha256:' + 'b'.repeat(64),
      resolvedImageDigest: 'sha256:' + 'a'.repeat(64),
      imagePlatform: 'linux/arm64',
      workingDirectory: '/workspace',
      mounts: [],
    },
    cwd: '/workspace',
    helper: {
      mode: 'image' as const,
      containerPath: '/usr/local/bin/lace-runtime-helper',
      command: ['/usr/local/bin/lace-runtime-helper'],
    },
  };
}

describe('ProjectedContainerToolRuntime helper', () => {
  it('uses helper for container-local read when no hostPath exists', async () => {
    const manager = createFakeContainerManagerWithHelper({
      response: { ok: true, value: 'container-only' },
    });
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: containerDescriptorWithHelper(),
    });

    const path = await runtime.paths.resolve('/tmp/container-only.txt');
    await expect(runtime.fs.readTextFile(path)).resolves.toBe('container-only');
  });
});
