// ABOUTME: Unit tests for AppleContainerRuntime.execStream with mocked child_process
// ABOUTME: Covers spawn-error rejection, stdout/stderr piping, wait(), and kill() propagation

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcess } from 'child_process';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: spawnMock,
  };
});

// Imported AFTER vi.mock so the module picks up the mocked spawn.
import { AppleContainerRuntime } from '../apple-container';
import { ContainerError, type ContainerInfo } from '../types';

interface FakeChild {
  child: ChildProcess;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
  emit: EventEmitter['emit'];
}

function makeFakeChild(): FakeChild {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const kill = vi.fn();

  Object.assign(emitter, { stdin, stdout, stderr, kill });

  return {
    child: emitter as unknown as ChildProcess,
    stdin,
    stdout,
    stderr,
    kill,
    emit: emitter.emit.bind(emitter),
  };
}

// Bypass the constructor's `container list` probe so these tests don't depend
// on the apple-container CLI being installed.
function makeRuntime(): AppleContainerRuntime {
  const runtime = new AppleContainerRuntime();
  const internal = runtime as unknown as { readyPromise: Promise<void> };
  // Swallow any rejection from the real readiness probe before we override.
  internal.readyPromise.catch(() => {});
  internal.readyPromise = Promise.resolve();
  return runtime;
}

function setupRunningContainer(runtime: AppleContainerRuntime): string {
  const containerId = runtime.create({
    id: 'stream-test',
    image: 'mcr.microsoft.com/devcontainers/base:ubuntu',
    workingDirectory: '/workspace',
    mounts: [],
  });
  const map = (runtime as unknown as { containers: Map<string, ContainerInfo> }).containers;
  const info = map.get(containerId);
  if (!info) throw new Error(`test setup: container ${containerId} not registered`);
  info.state = 'running';
  return containerId;
}

describe('AppleContainerRuntime.execStream', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('throws ContainerError when the container is not running', async () => {
    const runtime = makeRuntime();
    const containerId = runtime.create({
      id: 'not-running',
      image: 'mcr.microsoft.com/devcontainers/base:ubuntu',
      workingDirectory: '/workspace',
      mounts: [],
    });

    await expect(runtime.execStream(containerId, { command: ['echo', 'hi'] })).rejects.toThrow(
      ContainerError
    );
  });

  it('builds correct args: exec -i, env flags, -w, container id, command', async () => {
    const runtime = makeRuntime();
    const containerId = setupRunningContainer(runtime);

    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child);
    setImmediate(() => fake.emit('spawn'));

    await runtime.execStream(containerId, {
      command: ['echo', 'hi'],
      workingDirectory: '/work',
      environment: { FOO: 'bar' },
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(
      'container',
      ['exec', '-i', '-e', 'FOO=bar', '-w', '/work', containerId, 'echo', 'hi'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
    );
  });

  it("rejects when the child emits 'error' before 'spawn' (CLI not on PATH)", async () => {
    const runtime = makeRuntime();
    const containerId = setupRunningContainer(runtime);

    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child);
    setImmediate(() => fake.emit('error', new Error('ENOENT: container')));

    await expect(runtime.execStream(containerId, { command: ['echo', 'hi'] })).rejects.toThrow(
      /ENOENT: container/
    );
  });

  it('streams stdout chunks to the consumer', async () => {
    const runtime = makeRuntime();
    const containerId = setupRunningContainer(runtime);

    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child);
    setImmediate(() => fake.emit('spawn'));

    const handle = await runtime.execStream(containerId, { command: ['echo', 'hi'] });

    const chunks: string[] = [];
    handle.stdout.on('data', (buf: Buffer) => chunks.push(buf.toString()));

    fake.stdout.write('hello ');
    fake.stdout.write('world');
    fake.stdout.end();

    await new Promise<void>((resolve) => handle.stdout.once('end', resolve));

    expect(chunks.join('')).toBe('hello world');
  });

  it('streams stderr chunks to the consumer', async () => {
    const runtime = makeRuntime();
    const containerId = setupRunningContainer(runtime);

    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child);
    setImmediate(() => fake.emit('spawn'));

    const handle = await runtime.execStream(containerId, { command: ['ls', 'nope'] });

    const chunks: string[] = [];
    handle.stderr.on('data', (buf: Buffer) => chunks.push(buf.toString()));

    fake.stderr.write('boom\n');
    fake.stderr.end();

    await new Promise<void>((resolve) => handle.stderr.once('end', resolve));

    expect(chunks.join('')).toBe('boom\n');
  });

  it('wait() resolves with the exit code emitted by the child', async () => {
    const runtime = makeRuntime();
    const containerId = setupRunningContainer(runtime);

    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child);
    setImmediate(() => fake.emit('spawn'));

    const handle = await runtime.execStream(containerId, { command: ['true'] });

    setImmediate(() => fake.emit('exit', 42, null));

    const result = await handle.wait();
    expect(result.exitCode).toBe(42);
  });

  it('wait() resolves with 128+signum convention when child is killed by signal', async () => {
    const runtime = makeRuntime();
    const containerId = setupRunningContainer(runtime);

    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child);
    setImmediate(() => fake.emit('spawn'));

    const handle = await runtime.execStream(containerId, { command: ['sleep', '10'] });

    setImmediate(() => fake.emit('exit', null, 'SIGTERM'));

    const result = await handle.wait();
    expect(result.exitCode).toBe(143); // 128 + 15
  });

  it('exposes a stdin that delivers writes to the child', async () => {
    const runtime = makeRuntime();
    const containerId = setupRunningContainer(runtime);

    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child);
    setImmediate(() => fake.emit('spawn'));

    const handle = await runtime.execStream(containerId, { command: ['cat'] });

    const received: string[] = [];
    fake.stdin.on('data', (buf: Buffer) => received.push(buf.toString()));

    handle.stdin.write('one ');
    handle.stdin.end('two');

    await new Promise<void>((resolve) => fake.stdin.once('end', resolve));

    expect(received.join('')).toBe('one two');
  });

  it('wait() resolves with -1 if the child errors after spawn', async () => {
    const runtime = makeRuntime();
    const containerId = setupRunningContainer(runtime);

    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child);
    setImmediate(() => fake.emit('spawn'));

    const handle = await runtime.execStream(containerId, { command: ['true'] });

    setImmediate(() => fake.emit('error', new Error('EIO mid-stream')));

    const result = await handle.wait();
    expect(result.exitCode).toBe(-1);
  });

  it('kill() forwards the signal to the underlying child', async () => {
    const runtime = makeRuntime();
    const containerId = setupRunningContainer(runtime);

    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake.child);
    setImmediate(() => fake.emit('spawn'));

    const handle = await runtime.execStream(containerId, { command: ['sleep', '10'] });

    handle.kill('SIGTERM');
    expect(fake.kill).toHaveBeenCalledWith('SIGTERM');

    handle.kill();
    expect(fake.kill).toHaveBeenCalledWith(undefined);
  });
});
