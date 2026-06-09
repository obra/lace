// ABOUTME: Tests for ContainerExecNetworkClient, the url_fetch runtime over brokered curl.
// ABOUTME: Drives a fake RuntimeProcessRunner to assert argv shape, base64 byte fidelity, redirects, and limits.

import { Readable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { ContainerExecNetworkClient } from '../container-exec-network';
import { RuntimeFetchSizeLimitError } from '../types';
import type { RuntimeProcessRunner, RuntimeProcessHandle } from '../types';

interface FakeStart {
  /** Raw bytes that curl|base64 would have produced on stdout (we base64 them). */
  stdoutRaw?: Buffer;
  /** Pre-encoded base64 stdout, used instead of stdoutRaw when present. */
  stdoutBase64?: string;
  stderr?: string;
  exitCode?: number | null;
}

function fakeRunner(start: FakeStart): {
  runner: RuntimeProcessRunner;
  calls: string[][];
  stdinWrites: string[];
} {
  const calls: string[][] = [];
  const stdinWrites: string[] = [];
  const runner: RuntimeProcessRunner = {
    async exec(command) {
      calls.push(command);
      return { exitCode: 0, stdout: '', stderr: '' };
    },
    async start(command): Promise<RuntimeProcessHandle> {
      calls.push(command);
      const base64 = start.stdoutBase64 ?? (start.stdoutRaw ?? Buffer.alloc(0)).toString('base64');
      return {
        stdin: {
          end: (c?: string, _enc?: string, cb?: () => void) => {
            if (typeof c === 'string') stdinWrites.push(c);
            cb?.();
          },
          once: () => {},
        } as never,
        stdout: Readable.from([base64]),
        stderr: Readable.from([start.stderr ?? '']),
        kill: () => {},
        completion: Promise.resolve({ exitCode: start.exitCode ?? 0 }),
      };
    },
  };
  return { runner, calls, stdinWrites };
}

describe('ContainerExecNetworkClient', () => {
  it('parses a 200 text response (status, headers, body)', async () => {
    const raw = Buffer.from('HTTP/2 200\r\ncontent-type: text/plain\r\n\r\nhello body', 'utf8');
    const { runner } = fakeRunner({ stdoutRaw: raw });
    const client = new ContainerExecNetworkClient(runner);
    const result = await client.fetch('https://example.com');
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toBe('text/plain');
    expect(Buffer.from(result.body).toString()).toBe('hello body');
  });

  it('preserves raw binary body bytes through the base64 path', async () => {
    const bodyBytes = Buffer.from([0xff, 0x00, 0xc3, 0x28]);
    const raw = Buffer.concat([
      Buffer.from('HTTP/2 200\r\ncontent-type: application/octet-stream\r\n\r\n', 'utf8'),
      bodyBytes,
    ]);
    const { runner } = fakeRunner({ stdoutRaw: raw });
    const client = new ContainerExecNetworkClient(runner);
    const result = await client.fetch('https://example.com/blob');
    expect(Buffer.from(result.body).equals(bodyBytes)).toBe(true);
  });

  it('POST writes body to stdin, passes --data-binary @-, and never leaks body into argv', async () => {
    const raw = Buffer.from('HTTP/2 200\r\n\r\nok', 'utf8');
    const { runner, calls, stdinWrites } = fakeRunner({ stdoutRaw: raw });
    const client = new ContainerExecNetworkClient(runner);
    const secret = 'super-secret-payload';
    await client.fetch('https://example.com/post', { method: 'POST', body: secret });
    const argv = calls[0]!;
    expect(stdinWrites).toContain(secret);
    expect(argv).toContain('--data-binary');
    expect(argv).toContain('@-');
    expect(argv).not.toContain(secret);
    expect(argv.join(' ')).not.toContain(secret);
  });

  it('rejects with RuntimeFetchSizeLimitError when body exceeds maxBytes', async () => {
    const raw = Buffer.from('HTTP/2 200\r\n\r\n0123456789', 'utf8');
    const { runner } = fakeRunner({ stdoutRaw: raw });
    const client = new ContainerExecNetworkClient(runner);
    await expect(client.fetch('https://example.com', { maxBytes: 5 })).rejects.toBeInstanceOf(
      RuntimeFetchSizeLimitError
    );
  });

  it('redirect "follow" adds -L and uses the LAST header block status', async () => {
    const raw = Buffer.from(
      'HTTP/2 301\r\nlocation: https://example.com/final\r\n\r\n' +
        'HTTP/2 200\r\ncontent-type: text/plain\r\n\r\nfinal body',
      'utf8'
    );
    const { runner, calls } = fakeRunner({ stdoutRaw: raw });
    const client = new ContainerExecNetworkClient(runner);
    const result = await client.fetch('https://example.com', { redirect: 'follow' });
    expect(calls[0]).toContain('-L');
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toBe('text/plain');
    expect(Buffer.from(result.body).toString()).toBe('final body');
  });

  it('surfaces curl failure (non-zero exit) as a rejection', async () => {
    const { runner } = fakeRunner({
      exitCode: 7,
      stderr: 'curl: (7) Failed to connect',
      stdoutRaw: Buffer.alloc(0),
    });
    const client = new ContainerExecNetworkClient(runner);
    await expect(client.fetch('https://unreachable.example')).rejects.toThrow(/Failed to connect/);
  });
});
