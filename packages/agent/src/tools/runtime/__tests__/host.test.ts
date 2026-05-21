import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostToolRuntime } from '../host';

describe('HostToolRuntime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves relative paths against cwd and reads files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lace-host-runtime-'));
    await writeFile(join(dir, 'file.txt'), 'hello', 'utf8');

    const runtime = new HostToolRuntime({ id: 'rt_host', cwd: dir });
    const path = await runtime.paths.resolve('file.txt');

    expect(path.runtimePath).toBe(join(dir, 'file.txt'));
    expect(runtime.paths.canonicalKey(path)).toBe(join(dir, 'file.txt'));
    await expect(runtime.fs.readTextFile(path)).resolves.toBe('hello');
  });

  it('executes commands in cwd', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'lace-host-runtime-')));
    const runtime = new HostToolRuntime({ id: 'rt_host', cwd: dir });

    const result = await runtime.process.exec([
      'node',
      '-e',
      'process.stdout.write(process.cwd())',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(dir);
  });

  it('returns structured results for commands that exit non-zero', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lace-host-runtime-'));
    const runtime = new HostToolRuntime({ id: 'rt_host', cwd: dir });

    const result = await runtime.process.exec([
      'node',
      '-e',
      "process.stdout.write('out'); process.stderr.write('err'); process.exit(3);",
    ]);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
  });

  it('applies default environment to exec commands', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lace-host-runtime-'));
    const runtime = new HostToolRuntime({
      id: 'rt_host',
      cwd: dir,
      env: { LACE_HOST_RUNTIME_ENV_TEST: 'present' },
    });

    const result = await runtime.process.exec([
      'node',
      '-e',
      "process.stdout.write(`${process.env.LACE_HOST_RUNTIME_ENV_TEST}:${process.env.PATH ? 'path' : 'missing'}`)",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('present:path');
  });

  it('does not expose default environment through JSON serialization', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lace-host-runtime-'));
    const runtime = new HostToolRuntime({
      id: 'rt_host',
      cwd: dir,
      env: { LACE_HOST_RUNTIME_SECRET_TEST: 'sentinel-secret-value' },
    });

    expect(JSON.stringify(runtime)).not.toContain('sentinel-secret-value');
  });

  it('rejects start completion when spawn fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lace-host-runtime-'));
    const runtime = new HostToolRuntime({ id: 'rt_host', cwd: dir });

    const handle = await runtime.process.start(['lace-host-runtime-missing-command']);

    await expect(handle.completion).rejects.toThrow(/lace-host-runtime-missing-command/);
  });

  it('rejects start completion when the process is aborted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lace-host-runtime-'));
    const runtime = new HostToolRuntime({ id: 'rt_host', cwd: dir });
    const abortController = new AbortController();

    const handle = await runtime.process.start(['node', '-e', 'setInterval(() => {}, 1000);'], {
      signal: abortController.signal,
    });
    abortController.abort();

    await expect(handle.completion).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('writes text files through runtime fs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lace-host-runtime-'));
    const runtime = new HostToolRuntime({ id: 'rt_host', cwd: dir });
    const path = await runtime.paths.resolve('out.txt');

    await runtime.fs.writeTextFile(path, 'content');

    await expect(readFile(join(dir, 'out.txt'), 'utf8')).resolves.toBe('content');
  });

  it('passes redirect mode to global fetch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lace-host-runtime-'));
    const runtime = new HostToolRuntime({ id: 'rt_host', cwd: dir });
    const mockFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(
      new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    await runtime.network.fetch('https://example.test/redirect', { redirect: 'manual' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.test/redirect',
      expect.objectContaining({
        redirect: 'manual',
      })
    );
  });
});
