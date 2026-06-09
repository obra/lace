// ABOUTME: Tests for ContainerExecFileSystem, the file_* runtime over brokered docker exec.
// ABOUTME: Drives a fake RuntimeProcessRunner to assert command shapes, base64 transport, and error mapping.

import { Readable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { ContainerExecFileSystem } from '../container-exec-fs';
import type { RuntimeProcessRunner, RuntimeProcessResult, RuntimePath } from '../types';

interface FakeStartOptions {
  exitCode?: number;
  stderr?: string;
}

function fakeRunner(
  handlers: Record<string, RuntimeProcessResult>,
  startOverride?: FakeStartOptions
): {
  runner: RuntimeProcessRunner;
  calls: string[][];
  stdinWrites: string[];
} {
  const calls: string[][] = [];
  const stdinWrites: string[] = [];
  const runner: RuntimeProcessRunner = {
    async exec(command) {
      calls.push(command);
      return handlers[command[0]!] ?? { exitCode: 0, stdout: '', stderr: '' };
    },
    async start(command) {
      calls.push(command);
      const exitCode = startOverride?.exitCode ?? handlers[command[0]!]?.exitCode ?? 0;
      const stderrContent = startOverride?.stderr ?? '';
      const stderrStream = Readable.from([stderrContent]);
      return {
        stdin: {
          end: (c: string, _enc: string, cb: () => void) => {
            stdinWrites.push(c);
            cb();
          },
          once: () => {},
        } as never,
        stdout: undefined,
        stderr: stderrStream,
        kill: () => {},
        completion: Promise.resolve({ exitCode }),
      };
    },
  };
  return { runner, calls, stdinWrites };
}

const path = (p: string): RuntimePath => ({ original: p, runtimePath: p, displayPath: p });

describe('ContainerExecFileSystem', () => {
  it('readTextFile base64-decodes cat output', async () => {
    const { runner, calls } = fakeRunner({
      base64: { exitCode: 0, stdout: Buffer.from('hello').toString('base64'), stderr: '' },
    });
    const fs = new ContainerExecFileSystem(runner);
    expect(await fs.readTextFile(path('/sen/mutable-identity/identity.md'))).toBe('hello');
    expect(calls[0]).toEqual(['base64', '/sen/mutable-identity/identity.md']);
  });

  it('stat parses size|type|epoch', async () => {
    const { runner } = fakeRunner({
      stat: { exitCode: 0, stdout: '42|regular file|1700000000', stderr: '' },
    });
    const fs = new ContainerExecFileSystem(runner);
    const s = await fs.stat(path('/sen/x'));
    expect(s.size).toBe(42);
    expect(s.type).toBe('file');
    expect(s.mtime.getTime()).toBe(1700000000 * 1000);
  });

  it('stat maps %F "directory" to type "directory"', async () => {
    const { runner } = fakeRunner({
      stat: { exitCode: 0, stdout: '0|directory|1700000000', stderr: '' },
    });
    const fs = new ContainerExecFileSystem(runner);
    const s = await fs.stat(path('/sen/x'));
    expect(s.type).toBe('directory');
  });

  it('readdir parses NUL-delimited find output to {name,type}', async () => {
    const { runner } = fakeRunner({
      find: { exitCode: 0, stdout: 'd\tsub\0f\tnote.md\0', stderr: '' },
    });
    const fs = new ContainerExecFileSystem(runner);
    const entries = await fs.readdir(path('/knowledge'));
    expect(entries).toEqual([
      { name: 'sub', type: 'directory' },
      { name: 'note.md', type: 'file' },
    ]);
  });

  it('readTextFile throws ENOENT on missing file', async () => {
    const { runner } = fakeRunner({
      base64: { exitCode: 1, stdout: '', stderr: 'base64: /sen/x: No such file or directory' },
    });
    const fs = new ContainerExecFileSystem(runner);
    await expect(fs.readTextFile(path('/sen/x'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('writeTextFile sends base64(content) on stdin', async () => {
    const { runner, stdinWrites } = fakeRunner({ sh: { exitCode: 0, stdout: '', stderr: '' } });
    const fs = new ContainerExecFileSystem(runner);
    await fs.writeTextFile(path('/sen/mutable-identity/identity.md'), 'new body');
    expect(Buffer.from(stdinWrites[0]!, 'base64').toString('utf8')).toBe('new body');
  });

  it('readTextFile round-trips UTF-8 multibyte content via base64', async () => {
    const text = 'café — 日本語 — \u{1F4A1}number';
    const { runner } = fakeRunner({
      base64: { exitCode: 0, stdout: Buffer.from(text, 'utf8').toString('base64'), stderr: '' },
    });
    const fs = new ContainerExecFileSystem(runner);
    const out = await fs.readTextFile(path('/sen/x'));
    expect(out).toBe(text);
  });

  it('mkdir issues correct argv', async () => {
    const { runner, calls } = fakeRunner({
      mkdir: { exitCode: 0, stdout: '', stderr: '' },
    });
    const fs = new ContainerExecFileSystem(runner);
    await fs.mkdir(path('/sen/x'));
    expect(calls[0]).toEqual(['mkdir', '/sen/x']);
  });

  it('mkdir with recursive:true adds -p flag', async () => {
    const { runner, calls } = fakeRunner({
      mkdir: { exitCode: 0, stdout: '', stderr: '' },
    });
    const fs = new ContainerExecFileSystem(runner);
    await fs.mkdir(path('/sen/x'), { recursive: true });
    expect(calls[0]).toEqual(['mkdir', '-p', '/sen/x']);
  });

  it('stat non-zero exit propagates error with nodeErrorFromExec code', async () => {
    const { runner } = fakeRunner({
      stat: { exitCode: 1, stdout: '', stderr: 'stat: /sen/x: No such file or directory' },
    });
    const fs = new ContainerExecFileSystem(runner);
    await expect(fs.stat(path('/sen/x'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('readdir non-zero exit propagates error with nodeErrorFromExec code', async () => {
    const { runner } = fakeRunner({
      find: { exitCode: 1, stdout: '', stderr: 'find: /sen/x: No such file or directory' },
    });
    const fs = new ContainerExecFileSystem(runner);
    await expect(fs.readdir(path('/sen/x'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('writeTextFile non-zero exit propagates error from stderr', async () => {
    const { runner } = fakeRunner(
      { sh: { exitCode: 1, stdout: '', stderr: '' } },
      { exitCode: 1, stderr: 'base64: write error: No space left on device' }
    );
    const fs = new ContainerExecFileSystem(runner);
    await expect(fs.writeTextFile(path('/sen/x'), 'data')).rejects.toMatchObject({
      code: 'ENOSPC',
    });
  });
});
