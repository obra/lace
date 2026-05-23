import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { ProjectedContainerToolRuntime } from '../projected-container';

function createFakeContainerManagerWithHelper(input: {
  response: { ok: true; value: unknown } | { ok: false; error: unknown };
}) {
  return {
    materialize: vi.fn().mockResolvedValue({
      spec: containerDescriptorWithHelper().spec,
      containerId: 'container_123',
      state: 'running' as const,
    }),
    execStream: vi.fn().mockResolvedValue({
      stdin: new PassThrough(),
      stdout: Readable.from([`${JSON.stringify(input.response)}\n`]),
      stderr: Readable.from([]),
      wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
      kill: vi.fn(),
    }),
  };
}

function createAbortableContainerManagerWithHelper() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let finished = false;
  let resolveWait!: (result: { exitCode: number }) => void;
  const waitPromise = new Promise<{ exitCode: number }>((resolve) => {
    resolveWait = resolve;
  });
  const abortError = Object.assign(new Error('The operation was aborted'), {
    name: 'AbortError',
  });
  const handle = {
    stdin: new PassThrough(),
    stdout,
    stderr,
    wait: vi.fn().mockReturnValue(waitPromise),
    kill: vi.fn(() => {
      if (finished) return;
      finished = true;
      stdout.destroy(abortError);
      stderr.end();
      resolveWait({ exitCode: 130 });
    }),
  };

  return {
    materialize: vi.fn().mockResolvedValue({
      spec: containerDescriptorWithHelper().spec,
      containerId: 'container_123',
      state: 'running' as const,
    }),
    execStream: vi.fn().mockResolvedValue(handle),
    finish() {
      if (finished) return;
      finished = true;
      stdout.end(
        `${JSON.stringify({ ok: true, value: { status: 200, headers: {}, body: '' } })}\n`
      );
      stderr.end();
      resolveWait({ exitCode: 0 });
    },
    handle,
  };
}

function containerDescriptorWithHelper() {
  return {
    spec: {
      name: 'projected-runtime',
      containerId: 'container_123',
      image: 'example/app@sha256:' + 'b'.repeat(64),
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

  it('kills helper-backed fetch when the request is aborted', async () => {
    const manager = createAbortableContainerManagerWithHelper();
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: containerDescriptorWithHelper(),
    });
    const abortController = new AbortController();
    const fetchResult = runtime.network
      .fetch('https://example.test/data', { signal: abortController.signal })
      .then(
        (value) => ({ status: 'resolved' as const, value }),
        (error: unknown) => ({ status: 'rejected' as const, error })
      );

    await vi.waitFor(() => expect(manager.execStream).toHaveBeenCalledTimes(1));
    abortController.abort();

    try {
      await vi.waitFor(() => expect(manager.handle.kill).toHaveBeenCalledTimes(1), {
        timeout: 100,
      });
      await expect(fetchResult).resolves.toMatchObject({
        status: 'rejected',
        error: { name: 'AbortError' },
      });
    } finally {
      manager.finish();
      await fetchResult;
    }
  });

  it('times out helper-backed operations that do not produce a response', async () => {
    vi.useFakeTimers();
    try {
      const manager = {
        materialize: vi.fn().mockResolvedValue({
          spec: containerDescriptorWithHelper().spec,
          containerId: 'container_123',
          state: 'running' as const,
        }),
        execStream: vi.fn().mockResolvedValue({
          stdin: new PassThrough(),
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          wait: vi.fn().mockReturnValue(new Promise(() => undefined)),
          kill: vi.fn(),
        }),
      };
      const runtime = new ProjectedContainerToolRuntime({
        id: 'rt_container',
        containerManager: manager,
        descriptor: containerDescriptorWithHelper(),
      });

      const path = await runtime.paths.resolve('/tmp/hangs.txt');
      const read = runtime.fs.readTextFile(path);
      // Attach a handler eagerly so vitest does not log a transient
      // unhandled rejection when fake timers drive the abort synchronously.
      read.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(30_001);

      await expect(read).rejects.toThrow(/timed out/i);
      expect((await manager.execStream.mock.results[0].value).kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes fetch options to helper-backed fetch', async () => {
    const responseBytes = Uint8Array.from([0, 255, 65, 66]);
    const stdin = new PassThrough();
    let request = '';
    stdin.on('data', (chunk: Buffer | string) => {
      request += chunk.toString();
    });
    const manager = {
      materialize: vi.fn().mockResolvedValue({
        spec: containerDescriptorWithHelper().spec,
        containerId: 'container_123',
        state: 'running' as const,
      }),
      execStream: vi.fn().mockResolvedValue({
        stdin,
        stdout: Readable.from([
          `${JSON.stringify({
            ok: true,
            value: {
              status: 200,
              headers: {},
              body: Buffer.from(responseBytes).toString('base64'),
            },
          })}\n`,
        ]),
        stderr: Readable.from([]),
        wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
        kill: vi.fn(),
      }),
    };
    const runtime = new ProjectedContainerToolRuntime({
      id: 'rt_container',
      containerManager: manager,
      descriptor: containerDescriptorWithHelper(),
    });

    const result = await runtime.network.fetch('https://example.test/redirect', {
      redirect: 'manual',
      maxBytes: 4096,
    });

    expect(Array.from(result.body)).toEqual(Array.from(responseBytes));
    expect(JSON.parse(request)).toMatchObject({
      op: 'fetch',
      url: 'https://example.test/redirect',
      redirect: 'manual',
      maxBytes: 4096,
    });
  });
});
