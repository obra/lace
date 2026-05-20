import { PassThrough, Readable } from 'node:stream';
import { vi } from 'vitest';
import type { RuntimePath, ToolRuntime } from '../types';

type FakeRuntimeInput = {
  resolve?: RuntimePath;
  canonicalKey?: string;
  statType?: 'file' | 'directory';
  readText?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  fetchResult?: {
    status: number;
    headers: Record<string, string>;
    body: Uint8Array;
  };
};

function defaultPath(): RuntimePath {
  return {
    original: 'a.txt',
    runtimePath: '/runtime/a.txt',
    displayPath: 'a.txt',
  };
}

function createFakeProcess(input: FakeRuntimeInput) {
  const stdin = new PassThrough();
  const stdout = Readable.from([input.stdout ?? '']);
  const stderr = Readable.from([input.stderr ?? '']);

  return {
    pid: 123,
    stdin,
    stdout,
    stderr,
    kill: vi.fn(() => true),
    completion: Promise.resolve({
      exitCode: input.exitCode ?? 0,
      signal: undefined,
    }),
  };
}

export function createFakeRuntime(input: FakeRuntimeInput = {}): ToolRuntime {
  const resolved = input.resolve ?? defaultPath();
  const runtime: ToolRuntime = {
    id: 'rt_fake',
    kind: 'local',
    cwd: '/runtime',
    label: 'Fake',
    paths: {
      resolve: vi.fn().mockResolvedValue(resolved),
      canonicalKey: vi.fn().mockReturnValue(input.canonicalKey ?? resolved.runtimePath),
    },
    fs: {
      stat: vi.fn().mockResolvedValue({
        type: input.statType ?? 'file',
        size: input.readText?.length ?? 5,
        mtime: new Date('2026-05-20T00:00:00.000Z'),
      }),
      readTextFile: vi.fn().mockResolvedValue(input.readText ?? 'hello'),
      writeTextFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
    },
    process: {
      exec: vi.fn().mockResolvedValue({
        exitCode: input.exitCode ?? 0,
        stdout: input.stdout ?? '',
        stderr: input.stderr ?? '',
      }),
      start: vi.fn().mockImplementation(async () => createFakeProcess(input)),
    },
    network: {
      fetch: vi.fn().mockResolvedValue(
        input.fetchResult ?? {
          status: 200,
          headers: {},
          body: new Uint8Array(),
        }
      ),
    },
  };

  return runtime;
}

export function createFakeRuntimeForProcess(input: FakeRuntimeInput = {}): ToolRuntime {
  return createFakeRuntime(input);
}

export function createStreamingFakeRuntime(input: FakeRuntimeInput = {}): ToolRuntime {
  return createFakeRuntime(input);
}
