import { describe, expect, it, vi } from 'vitest';
import { PassThrough, Readable } from 'node:stream';
import { RuntimeStdioClientTransport } from '../runtime-stdio-transport';
import { createFakeRuntime } from './fake-runtime';
import type { ToolRuntime } from '../types';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  getDefaultEnvironment: vi.fn(() => ({ HOME: '/host-home', PATH: '/host-bin' })),
}));

function runtimeWithStdout(chunk: string | Buffer): ToolRuntime {
  const runtime = createFakeRuntime();
  runtime.process.start = vi.fn(async () => ({
    pid: 123,
    stdin: new PassThrough(),
    stdout: Readable.from([chunk]),
    stderr: Readable.from([]),
    kill: vi.fn(),
    completion: Promise.resolve({ exitCode: 0, signal: undefined }),
  }));
  return runtime;
}

async function readOneMessage(chunk: string | Buffer): Promise<JSONRPCMessage> {
  const transport = new RuntimeStdioClientTransport({
    runtime: runtimeWithStdout(chunk),
    command: 'node',
  });
  const message = new Promise<JSONRPCMessage>((resolve, reject) => {
    transport.onmessage = resolve;
    transport.onerror = reject;
  });

  await transport.start();
  return await message;
}

describe('RuntimeStdioClientTransport', () => {
  it('parses newline-delimited JSON from string stdout chunks', async () => {
    await expect(
      readOneMessage('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
    ).resolves.toEqual({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
  });

  it('parses newline-delimited JSON from Buffer stdout chunks', async () => {
    await expect(
      readOneMessage(Buffer.from('{"jsonrpc":"2.0","method":"notifications/initialized"}\n'))
    ).resolves.toEqual({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
  });

  it('uses SDK default environment for host-like runtimes', async () => {
    const runtime = runtimeWithStdout('');
    const transport = new RuntimeStdioClientTransport({
      runtime,
      command: 'node',
      env: { DECLARED: 'visible' },
    });

    await transport.start();

    expect(runtime.process.start).toHaveBeenCalledWith(['node'], {
      cwd: '/runtime',
      env: { HOME: '/host-home', PATH: '/host-bin', DECLARED: 'visible' },
      envMode: 'replace',
    });
  });

  it('uses inherited environment for container runtimes so image PATH is preserved', async () => {
    const runtime = runtimeWithStdout('');
    Object.assign(runtime, { kind: 'container' });
    const transport = new RuntimeStdioClientTransport({
      runtime,
      command: 'node',
      env: { DECLARED: 'visible' },
    });

    await transport.start();

    expect(runtime.process.start).toHaveBeenCalledWith(['node'], {
      cwd: '/runtime',
      env: { DECLARED: 'visible' },
      envMode: 'inherit',
    });
  });
});
