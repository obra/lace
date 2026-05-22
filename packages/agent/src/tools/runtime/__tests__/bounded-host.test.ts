import { access, mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceToolRuntime } from '../workspace';

describe('WorkspaceToolRuntime', () => {
  async function makeTempRuntime() {
    const projectRoot = await mkdtemp(join(tmpdir(), 'lace-workspace-project-'));
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'lace-workspace-runtime-'));

    return {
      projectRoot,
      workspaceRoot,
      runtime: new WorkspaceToolRuntime({
        id: 'rt_ws',
        projectRoot,
        workspaceRoot,
        cwd: workspaceRoot,
      }),
    };
  }

  it('maps project absolute paths into workspace root', async () => {
    const runtime = new WorkspaceToolRuntime({
      id: 'rt_ws',
      projectRoot: '/project',
      workspaceRoot: '/tmp/workspace',
      cwd: '/tmp/workspace',
    });

    await expect(runtime.paths.resolve('/project/src/app.ts')).resolves.toMatchObject({
      runtimePath: '/tmp/workspace/src/app.ts',
      hostPath: '/tmp/workspace/src/app.ts',
      displayPath: '/project/src/app.ts',
    });
  });

  it('accepts runtime-visible absolute paths inside workspace root', async () => {
    const runtime = new WorkspaceToolRuntime({
      id: 'rt_ws',
      projectRoot: '/project',
      workspaceRoot: '/tmp/workspace',
      cwd: '/tmp/workspace',
    });

    await expect(runtime.paths.resolve('/tmp/workspace/src/app.ts')).resolves.toMatchObject({
      runtimePath: '/tmp/workspace/src/app.ts',
      hostPath: '/tmp/workspace/src/app.ts',
      displayPath: '/tmp/workspace/src/app.ts',
    });
  });

  it('resolves relative paths against cwd', async () => {
    const runtime = new WorkspaceToolRuntime({
      id: 'rt_ws',
      projectRoot: '/project',
      workspaceRoot: '/tmp/workspace',
      cwd: '/tmp/workspace/packages/agent',
    });

    await expect(runtime.paths.resolve('src/index.ts')).resolves.toMatchObject({
      runtimePath: '/tmp/workspace/packages/agent/src/index.ts',
      hostPath: '/tmp/workspace/packages/agent/src/index.ts',
      displayPath: 'src/index.ts',
    });
  });

  it('rejects relative paths escaping workspace root', async () => {
    const runtime = new WorkspaceToolRuntime({
      id: 'rt_ws',
      projectRoot: '/project',
      workspaceRoot: '/tmp/workspace',
      cwd: '/tmp/workspace',
    });

    await expect(runtime.paths.resolve('../escape.txt')).rejects.toThrow(/outside workspace/i);
  });

  it('rejects absolute paths escaping project root', async () => {
    const runtime = new WorkspaceToolRuntime({
      id: 'rt_ws',
      projectRoot: '/project',
      workspaceRoot: '/tmp/workspace',
      cwd: '/tmp/workspace',
    });

    await expect(runtime.paths.resolve('/escape.txt')).rejects.toThrow(/outside workspace/i);
  });

  it('includes runtime id in canonical keys', async () => {
    const first = new WorkspaceToolRuntime({
      id: 'rt_ws_1',
      projectRoot: '/project',
      workspaceRoot: '/tmp/workspace',
      cwd: '/tmp/workspace',
    });
    const second = new WorkspaceToolRuntime({
      id: 'rt_ws_2',
      projectRoot: '/project',
      workspaceRoot: '/tmp/workspace',
      cwd: '/tmp/workspace',
    });

    const firstPath = await first.paths.resolve('/project/src/app.ts');
    const secondPath = await second.paths.resolve('/project/src/app.ts');

    expect(first.paths.canonicalKey(firstPath)).toBe('workspace:rt_ws_1:/tmp/workspace/src/app.ts');
    expect(second.paths.canonicalKey(secondPath)).toBe(
      'workspace:rt_ws_2:/tmp/workspace/src/app.ts'
    );
  });

  it('applies default environment to exec commands', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'lace-workspace-runtime-'));
    const cwd = join(workspaceRoot, 'nested');
    await mkdir(cwd);
    const resolvedCwd = await realpath(cwd);
    const runtime = new WorkspaceToolRuntime({
      id: 'rt_ws',
      projectRoot: '/project',
      workspaceRoot,
      cwd,
      env: { LACE_WORKSPACE_RUNTIME_ENV_TEST: 'present' },
    });

    const result = await runtime.process.exec([
      'node',
      '-e',
      "process.stdout.write(`${process.cwd()}:${process.env.LACE_WORKSPACE_RUNTIME_ENV_TEST}:${process.env.PATH ? 'path' : 'missing'}`)",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${resolvedCwd}:present:path`);
  });

  it('rejects reads through symlinks that escape the workspace root', async () => {
    const { runtime, workspaceRoot } = await makeTempRuntime();
    const outsideDir = await mkdtemp(join(tmpdir(), 'lace-workspace-outside-'));
    const outsideFile = join(outsideDir, 'secret.txt');
    await writeFile(outsideFile, 'outside secret', 'utf8');
    await symlink(outsideFile, join(workspaceRoot, 'secret-link.txt'));

    const path = await runtime.paths.resolve('secret-link.txt');

    await expect(runtime.fs.readTextFile(path)).rejects.toThrow(/outside workspace/i);
  });

  it('rejects stat through symlinks that escape the workspace root', async () => {
    const { runtime, workspaceRoot } = await makeTempRuntime();
    const outsideDir = await mkdtemp(join(tmpdir(), 'lace-workspace-outside-'));
    const outsideFile = join(outsideDir, 'secret.txt');
    await writeFile(outsideFile, 'outside secret', 'utf8');
    await symlink(outsideFile, join(workspaceRoot, 'secret-link.txt'));

    const path = await runtime.paths.resolve('secret-link.txt');

    await expect(runtime.fs.stat(path)).rejects.toThrow(/outside workspace/i);
  });

  it('rejects readdir through symlinks that escape the workspace root', async () => {
    const { runtime, workspaceRoot } = await makeTempRuntime();
    const outsideDir = await mkdtemp(join(tmpdir(), 'lace-workspace-outside-'));
    await writeFile(join(outsideDir, 'secret.txt'), 'outside secret', 'utf8');
    await symlink(outsideDir, join(workspaceRoot, 'outside-link'));

    const path = await runtime.paths.resolve('outside-link');

    await expect(runtime.fs.readdir(path)).rejects.toThrow(/outside workspace/i);
  });

  it('rejects writes through symlinked parents that escape the workspace root', async () => {
    const { runtime, workspaceRoot } = await makeTempRuntime();
    const outsideDir = await mkdtemp(join(tmpdir(), 'lace-workspace-outside-'));
    const outsideFile = join(outsideDir, 'new.txt');
    await symlink(outsideDir, join(workspaceRoot, 'outside-link'));

    const path = await runtime.paths.resolve('outside-link/new.txt');

    await expect(runtime.fs.writeTextFile(path, 'leaked')).rejects.toThrow(/outside workspace/i);
    await expect(access(outsideFile)).rejects.toThrow();
  });

  it('rejects process cwd overrides that escape the workspace root', async () => {
    const { runtime } = await makeTempRuntime();
    const outsideDir = await mkdtemp(join(tmpdir(), 'lace-workspace-outside-'));

    await expect(
      runtime.process.exec(['node', '-e', "process.stdout.write('spawned')"], {
        cwd: outsideDir,
      })
    ).rejects.toThrow(/outside workspace/i);
  });

  it('maps project-coordinate process cwd overrides into the workspace root', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'lace-workspace-project-'));
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'lace-workspace-runtime-'));
    const projectCwd = join(projectRoot, 'src');
    const workspaceCwd = join(workspaceRoot, 'src');
    await mkdir(projectCwd);
    await mkdir(workspaceCwd);
    const resolvedWorkspaceCwd = await realpath(workspaceCwd);
    const runtime = new WorkspaceToolRuntime({
      id: 'rt_ws',
      projectRoot,
      workspaceRoot,
      cwd: workspaceRoot,
    });

    const result = await runtime.process.exec(
      ['node', '-e', 'process.stdout.write(process.cwd())'],
      { cwd: projectCwd }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(resolvedWorkspaceCwd);
  });

  it('resolves relative process cwd overrides from the runtime cwd', async () => {
    const { runtime, workspaceRoot } = await makeTempRuntime();
    const nestedCwd = join(workspaceRoot, 'nested');
    await mkdir(nestedCwd);
    const resolvedNestedCwd = await realpath(nestedCwd);

    const result = await runtime.process.exec(
      ['node', '-e', 'process.stdout.write(process.cwd())'],
      { cwd: 'nested' }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(resolvedNestedCwd);
  });
});
