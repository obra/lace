import { access, mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BoundedHostToolRuntime } from '../bounded-host';

describe('BoundedHostToolRuntime', () => {
  function makeRuntime(prefix = 'lace-bounded-host-runtime-') {
    return mkdtemp(join(tmpdir(), prefix)).then((root) => ({
      root,
      runtime: new BoundedHostToolRuntime({
        id: 'rt_bounded',
        root,
        cwd: root,
      }),
    }));
  }

  it('resolves relative paths against cwd', async () => {
    const { runtime, root } = await makeRuntime();
    const nested = join(root, 'nested');
    await mkdtemp(nested);
    const path = await runtime.paths.resolve('nested');

    expect(path).toMatchObject({
      runtimePath: join(root, 'nested'),
      hostPath: join(root, 'nested'),
      displayPath: 'nested',
    });
  });

  it('accepts absolute paths inside the bounded root', async () => {
    const { runtime, root } = await makeRuntime();

    await expect(runtime.paths.resolve(root)).resolves.toMatchObject({
      runtimePath: root,
      hostPath: root,
      displayPath: root,
    });
  });

  it('rejects absolute paths outside the bounded root', async () => {
    const { runtime } = await makeRuntime();
    const outside = await mkdtemp(join(tmpdir(), 'lace-bounded-host-outside-'));

    await expect(runtime.paths.resolve(outside)).rejects.toThrow(/outside bounded host root/i);
  });

  it('rejects path escapes with ..', async () => {
    const { runtime } = await makeRuntime();

    await expect(runtime.paths.resolve('../escape.txt')).rejects.toThrow(
      /outside bounded host root/i
    );
  });

  it('rejects symlink reads that escape the bounded root', async () => {
    const { runtime, root } = await makeRuntime();
    const outsideRoot = await mkdtemp(join(tmpdir(), 'lace-bounded-host-outside-'));
    const outsideFile = join(outsideRoot, 'secret.txt');
    await writeFile(outsideFile, 'outside secret', 'utf8');
    await symlink(outsideFile, join(root, 'secret-link.txt'));

    const path = await runtime.paths.resolve('secret-link.txt');

    await expect(runtime.fs.readTextFile(path)).rejects.toThrow(/outside bounded host root/i);
  });

  it('rejects symlink stats that escape the bounded root', async () => {
    const { runtime, root } = await makeRuntime();
    const outsideRoot = await mkdtemp(join(tmpdir(), 'lace-bounded-host-outside-'));
    const outsideFile = join(outsideRoot, 'secret.txt');
    await writeFile(outsideFile, 'outside secret', 'utf8');
    await symlink(outsideFile, join(root, 'secret-link.txt'));

    const path = await runtime.paths.resolve('secret-link.txt');

    await expect(runtime.fs.stat(path)).rejects.toThrow(/outside bounded host root/i);
  });

  it('rejects symlink readdir that escape the bounded root', async () => {
    const { runtime, root } = await makeRuntime();
    const outsideRoot = await mkdtemp(join(tmpdir(), 'lace-bounded-host-outside-'));
    const outsideDir = join(outsideRoot, 'nested');
    await mkdir(outsideDir);
    await symlink(outsideDir, join(root, 'outside-link'));

    const path = await runtime.paths.resolve('outside-link');

    await expect(runtime.fs.readdir(path)).rejects.toThrow(/outside bounded host root/i);
  });

  it('rejects symlinked writes that escape the bounded root', async () => {
    const { runtime, root } = await makeRuntime();
    const outsideRoot = await mkdtemp(join(tmpdir(), 'lace-bounded-host-outside-'));
    await symlink(outsideRoot, join(root, 'outside-link'));

    const path = await runtime.paths.resolve('outside-link/new.txt');

    await expect(runtime.fs.writeTextFile(path, 'leaked')).rejects.toThrow(
      /outside bounded host root/i
    );
    await expect(access(join(outsideRoot, 'new.txt'))).rejects.toThrow();
  });

  it('rejects process cwd overrides that escape bounded root', async () => {
    const { runtime } = await makeRuntime();
    const outside = await mkdtemp(join(tmpdir(), 'lace-bounded-host-outside-'));

    await expect(
      runtime.process.exec(['node', '-e', "process.stdout.write('spawned')"], { cwd: outside })
    ).rejects.toThrow(/outside bounded host root/i);
  });

  it('resolves relative process cwd overrides from runtime cwd', async () => {
    const { runtime, root } = await makeRuntime();
    const nested = join(root, 'nested');
    await mkdir(nested);
    const resolvedNested = await realpath(nested);
    const result = await runtime.process.exec(
      ['node', '-e', 'process.stdout.write(process.cwd())'],
      { cwd: 'nested' }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(resolvedNested);
  });

  it('canonical keys include boundedHost runtime id and resolved root-local host path', async () => {
    const { runtime, root } = await makeRuntime();
    const path = await runtime.paths.resolve('pkg');
    expect(runtime.paths.canonicalKey(path)).toBe(`boundedHost:${runtime.id}:${path.runtimePath}`);
    expect(path.runtimePath.startsWith(root)).toBe(true);
  });
});
