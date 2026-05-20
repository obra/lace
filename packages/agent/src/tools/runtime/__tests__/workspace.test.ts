import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceToolRuntime } from '../workspace';

describe('WorkspaceToolRuntime', () => {
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
});
