import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HostToolRuntime } from '../host';

describe('HostToolRuntime', () => {
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

  it('writes text files through runtime fs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lace-host-runtime-'));
    const runtime = new HostToolRuntime({ id: 'rt_host', cwd: dir });
    const path = await runtime.paths.resolve('out.txt');

    await runtime.fs.writeTextFile(path, 'content');

    await expect(readFile(join(dir, 'out.txt'), 'utf8')).resolves.toBe('content');
  });
});
