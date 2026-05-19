// ABOUTME: Unit tests for AppleContainerRuntime.start() CLI arg shaping with mocked execFile
// ABOUTME: Asserts spec.ports propagates as -p host:container flags (kata #68)

import { describe, it, expect, beforeEach, vi } from 'vitest';

type Callback = (
  err: (Error & { code?: number | string; stderr?: string; stdout?: string }) | null,
  result?: { stdout: string; stderr: string }
) => void;

const { mockExecFile } = vi.hoisted(() => {
  const mockExecFile = vi.fn((...allArgs: unknown[]) => {
    const last = allArgs[allArgs.length - 1];
    if (typeof last === 'function') {
      (last as Callback)(null, { stdout: '', stderr: '' });
    }
  });
  return { mockExecFile };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFile: mockExecFile,
  };
});

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
}));

import { AppleContainerRuntime } from '../apple-container';

function findRunCall(): string[] | undefined {
  for (const call of mockExecFile.mock.calls) {
    const args = call[1] as string[];
    if (Array.isArray(args) && args[0] === 'run') return args;
  }
  return undefined;
}

function makeRuntime(): AppleContainerRuntime {
  const runtime = new AppleContainerRuntime();
  // Bypass the constructor's readiness probe so tests don't depend on real CLI.
  const internal = runtime as unknown as { readyPromise: Promise<void> };
  internal.readyPromise.catch(() => {});
  internal.readyPromise = Promise.resolve();
  return runtime;
}

describe('AppleContainerRuntime.start - CLI arg shaping', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
    mockExecFile.mockImplementation((...allArgs: unknown[]) => {
      const last = allArgs[allArgs.length - 1] as Callback;
      last(null, { stdout: '', stderr: '' });
    });
  });

  it('emits -p <host>:<container> for each spec.ports entry (kata #68)', async () => {
    const runtime = makeRuntime();
    const containerId = runtime.create({
      id: 'browser',
      image: 'sen-browser:dev',
      workingDirectory: '/w',
      mounts: [],
      ports: [
        { host: 7777, container: 7777 },
        { host: 6080, container: 6080 },
      ],
    });

    await runtime.start(containerId);

    const args = findRunCall();
    expect(args).toBeDefined();
    expect(args).toContain('-p');
    expect(args).toContain('7777:7777');
    expect(args).toContain('6080:6080');
    // Each -p flag must appear before the image (run arg order).
    const imageIdx = args!.indexOf('sen-browser:dev');
    for (const mapping of ['7777:7777', '6080:6080']) {
      expect(args!.indexOf(mapping)).toBeLessThan(imageIdx);
    }
  });

  it('emits no -p flags when ports is undefined or empty (kata #68)', async () => {
    const runtime = makeRuntime();

    const idA = runtime.create({
      id: 'no-ports',
      image: 'alpine:latest',
      workingDirectory: '/w',
      mounts: [],
    });
    await runtime.start(idA);
    expect(findRunCall()).not.toContain('-p');

    mockExecFile.mockClear();

    const idB = runtime.create({
      id: 'empty-ports',
      image: 'alpine:latest',
      workingDirectory: '/w',
      mounts: [],
      ports: [],
    });
    await runtime.start(idB);
    expect(findRunCall()).not.toContain('-p');
  });
});
