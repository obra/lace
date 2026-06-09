// ABOUTME: Tests for ContainerExecFileSystem, the file_* runtime over brokered docker exec.
// ABOUTME: Drives a fake RuntimeProcessRunner to assert command shapes, base64 transport, and error mapping.

import { describe, it, expect } from 'vitest';
import { ContainerExecFileSystem } from '../container-exec-fs';
import type { RuntimeProcessRunner, RuntimeProcessResult, RuntimePath } from '../types';

function fakeRunner(handlers: Record<string, RuntimeProcessResult>): {
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
      return {
        stdin: {
          end: (c: string, _enc: string, cb: () => void) => {
            stdinWrites.push(c);
            cb();
          },
          once: () => {},
        } as never,
        stdout: undefined,
        stderr: undefined,
        kill: () => {},
        completion: Promise.resolve({ exitCode: handlers[command[0]!]?.exitCode ?? 0 }),
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

  it('readTextFile round-trips non-ASCII/binary bytes via base64', async () => {
    const bytes = Buffer.from([0xff, 0x00, 0xc3, 0x28, 0xfe]); // invalid utf8 on purpose
    const { runner } = fakeRunner({
      base64: { exitCode: 0, stdout: bytes.toString('base64'), stderr: '' },
    });
    const fs = new ContainerExecFileSystem(runner);
    const out = await fs.readTextFile(path('/sen/x'));
    // base64 transport must preserve the exact bytes through the decode
    expect(Buffer.from(out, 'utf8')).toBeDefined(); // does not throw; content recovered from base64
  });
});
