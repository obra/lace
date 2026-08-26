// ABOUTME: RuntimeFileSystem implemented by shelling stock binaries through a brokered process runner.
// ABOUTME: Byte-bearing payloads are base64-wrapped so the runner's utf8 stdout/stdin transport is lossless.

import { FilesystemCallCeilingError } from './types';
import type { RuntimeFileSystem, RuntimePath, RuntimeProcessRunner } from './types';
import { nodeErrorFromExec, streamToString, writeStreamAndClose } from './container-exec-shared';

/**
 * Most filesystem calls one tool call may make against a container runtime.
 *
 * Every method here is a process spawn across a container boundary (~160ms), so
 * a per-entry loop is not slow, it is a hang: file_find's walk made 20,821 of
 * them in one call and ada-sen was silent for 96 minutes (PRI-2975). Nothing in
 * the node-`fs` shape of this interface hints at that, and a comment saying so
 * is only advice.
 *
 * 500 is far above any legitimate use — the repaired file_find makes at most a
 * few dozen, file_read and file_write make one or two — and far below the
 * pathological case. Crossing it means the caller is looping where it should
 * push the work into a single `runtime.process.exec`, so it fails immediately
 * and says so, instead of running for an hour and taking the coworker with it.
 */
export const FS_CALLS_PER_TOOL_CALL_CEILING = 500;

export class ContainerExecFileSystem implements RuntimeFileSystem {
  private callsThisToolCall = 0;

  constructor(private readonly process: RuntimeProcessRunner) {}

  /** Reset the per-tool-call budget. Called by the executor before each tool. */
  beginToolCall(): void {
    this.callsThisToolCall = 0;
  }

  /**
   * Account for one container round-trip, refusing past the ceiling.
   *
   * Throws rather than warns: a warning here would be written to a log nobody
   * reads while the coworker goes quiet, which is exactly what happened.
   */
  private charge(op: string, target: string): void {
    this.callsThisToolCall += 1;
    if (this.callsThisToolCall > FS_CALLS_PER_TOOL_CALL_CEILING) {
      throw new FilesystemCallCeilingError(
        `Refusing ${op}(${target}): over ${FS_CALLS_PER_TOOL_CALL_CEILING} filesystem calls in a single tool call. ` +
          `Each one is a process spawn into the container, so this pattern hangs the agent loop rather than merely running slowly. ` +
          `Do the traversal in one runtime.process.exec instead (see file_find's fast path or ripgrep_search). See PRI-2975.`
      );
    }
  }

  async stat(
    path: RuntimePath
  ): Promise<{ type: 'file' | 'directory'; size: number; mtime: Date }> {
    this.charge('stat', path.runtimePath);
    const p = path.runtimePath;
    const result = await this.process.exec(['stat', '-c', '%s|%F|%Y', p]);
    if (result.exitCode !== 0) {
      throw nodeErrorFromExec(result.exitCode, result.stderr, 'stat', p);
    }
    const parts = result.stdout.trim().split('|');
    return {
      size: Number(parts[0]),
      type: (parts[1] ?? '').includes('directory') ? 'directory' : 'file',
      mtime: new Date(Number(parts[2]) * 1000),
    };
  }

  async readTextFile(path: RuntimePath): Promise<string> {
    this.charge('readTextFile', path.runtimePath);
    const p = path.runtimePath;
    const result = await this.process.exec(['base64', p]);
    if (result.exitCode !== 0) {
      throw nodeErrorFromExec(result.exitCode, result.stderr, 'readTextFile', p);
    }
    return Buffer.from(result.stdout, 'base64').toString('utf8');
  }

  async writeTextFile(path: RuntimePath, content: string): Promise<void> {
    this.charge('writeTextFile', path.runtimePath);
    const p = path.runtimePath;
    const handle = await this.process.start(['sh', '-c', 'base64 -d > "$0"', p]);
    if (!handle.stdin) {
      handle.kill();
      throw new Error('ContainerExecFileSystem write stream unavailable');
    }
    await writeStreamAndClose(handle.stdin, Buffer.from(content, 'utf8').toString('base64'));
    const stderrPromise = streamToString(handle.stderr);
    const { exitCode } = await handle.completion;
    if (exitCode !== 0) {
      throw nodeErrorFromExec(exitCode ?? -1, await stderrPromise, 'writeTextFile', p);
    }
  }

  async mkdir(path: RuntimePath, opts?: { recursive?: boolean }): Promise<void> {
    this.charge('mkdir', path.runtimePath);
    const p = path.runtimePath;
    const result = await this.process.exec(['mkdir', ...(opts?.recursive ? ['-p'] : []), p]);
    if (result.exitCode !== 0) {
      throw nodeErrorFromExec(result.exitCode, result.stderr, 'mkdir', p);
    }
  }

  async readdir(path: RuntimePath): Promise<Array<{ name: string; type: 'file' | 'directory' }>> {
    this.charge('readdir', path.runtimePath);
    const p = path.runtimePath;
    const result = await this.process.exec([
      'find',
      p,
      '-maxdepth',
      '1',
      '-mindepth',
      '1',
      '-printf',
      '%y\\t%f\\0',
    ]);
    if (result.exitCode !== 0) {
      throw nodeErrorFromExec(result.exitCode, result.stderr, 'readdir', p);
    }
    return result.stdout
      .split('\0')
      .filter((entry) => entry.length > 0)
      .map((entry) => {
        const tab = entry.indexOf('\t');
        const y = entry.slice(0, tab);
        return {
          name: entry.slice(tab + 1),
          type: y === 'd' ? ('directory' as const) : ('file' as const),
        };
      });
  }
}
