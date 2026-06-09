// ABOUTME: RuntimeFileSystem implemented by shelling stock binaries through a brokered process runner.
// ABOUTME: Byte-bearing payloads are base64-wrapped so the runner's utf8 stdout/stdin transport is lossless.

import type { RuntimeFileSystem, RuntimePath, RuntimeProcessRunner } from './types';
import { nodeErrorFromExec, streamToString, writeStreamAndClose } from './container-exec-shared';

export class ContainerExecFileSystem implements RuntimeFileSystem {
  constructor(private readonly process: RuntimeProcessRunner) {}

  async stat(
    path: RuntimePath
  ): Promise<{ type: 'file' | 'directory'; size: number; mtime: Date }> {
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
    const p = path.runtimePath;
    const result = await this.process.exec(['base64', p]);
    if (result.exitCode !== 0) {
      throw nodeErrorFromExec(result.exitCode, result.stderr, 'readTextFile', p);
    }
    return Buffer.from(result.stdout, 'base64').toString('utf8');
  }

  async writeTextFile(path: RuntimePath, content: string): Promise<void> {
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
    const p = path.runtimePath;
    const result = await this.process.exec(['mkdir', ...(opts?.recursive ? ['-p'] : []), p]);
    if (result.exitCode !== 0) {
      throw nodeErrorFromExec(result.exitCode, result.stderr, 'mkdir', p);
    }
  }

  async readdir(path: RuntimePath): Promise<Array<{ name: string; type: 'file' | 'directory' }>> {
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
