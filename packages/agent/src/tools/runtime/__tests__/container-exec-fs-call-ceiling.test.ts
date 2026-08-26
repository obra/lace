// ABOUTME: A per-tool-call ceiling on high-latency filesystem calls (PRI-2975).
// ABOUTME: Documentation and a doctor check catch a per-entry loop only after it
// ABOUTME: has already wedged a coworker. This makes the abstraction refuse.

import { describe, it, expect, vi } from 'vitest';
import { ContainerExecFileSystem, FS_CALLS_PER_TOOL_CALL_CEILING } from '../container-exec-fs';
import type { RuntimePath, RuntimeProcessRunner } from '../types';

function path(p: string): RuntimePath {
  return { original: p, runtimePath: p, displayPath: p };
}

function stubRunner(): RuntimeProcessRunner {
  return {
    exec: vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '12|regular file|1700000000',
      stderr: '',
    }),
    start: vi.fn(),
  } as unknown as RuntimeProcessRunner;
}

describe('ContainerExecFileSystem per-tool-call ceiling (PRI-2975)', () => {
  it('allows ordinary usage well below the ceiling', async () => {
    const fs = new ContainerExecFileSystem(stubRunner());
    for (let i = 0; i < 50; i++) {
      await fs.stat(path(`/w/f${i}`));
    }
    await expect(fs.stat(path('/w/again'))).resolves.toBeDefined();
  });

  it('refuses once one tool call crosses the ceiling', async () => {
    const fs = new ContainerExecFileSystem(stubRunner());
    for (let i = 0; i < FS_CALLS_PER_TOOL_CALL_CEILING; i++) {
      await fs.stat(path(`/w/f${i}`));
    }

    await expect(fs.stat(path('/w/one-too-many'))).rejects.toThrow(
      /filesystem calls in a single tool call/i
    );
  });

  it('names the remedy rather than just failing', async () => {
    const fs = new ContainerExecFileSystem(stubRunner());
    for (let i = 0; i < FS_CALLS_PER_TOOL_CALL_CEILING; i++) {
      await fs.stat(path(`/w/f${i}`));
    }

    await expect(fs.stat(path('/w/boom'))).rejects.toThrow(/runtime\.process\.exec/);
  });

  it('resets per tool call, so a long session is not penalised', async () => {
    const fs = new ContainerExecFileSystem(stubRunner());
    for (let i = 0; i < FS_CALLS_PER_TOOL_CALL_CEILING; i++) {
      await fs.stat(path(`/w/f${i}`));
    }

    fs.beginToolCall();

    await expect(fs.stat(path('/w/fresh'))).resolves.toBeDefined();
  });

  it('counts every method, not just stat', async () => {
    const fs = new ContainerExecFileSystem(stubRunner());
    for (let i = 0; i < FS_CALLS_PER_TOOL_CALL_CEILING; i++) {
      await fs.readdir(path(`/w/d${i}`));
    }

    await expect(fs.readdir(path('/w/more'))).rejects.toThrow(/single tool call/i);
  });
});
