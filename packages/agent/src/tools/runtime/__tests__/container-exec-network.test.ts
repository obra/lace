// ABOUTME: Tests for ContainerExecNetworkClient, the url_fetch runtime over brokered curl.
// ABOUTME: Drives a fake RuntimeProcessRunner to assert argv shape, base64 byte fidelity, redirects, and limits.

import { Readable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { UrlFetchTool } from '@lace/agent/tools/implementations/url_fetch';
import { ContainerExecNetworkClient } from '../container-exec-network';
import { createFakeRuntime } from './fake-runtime';
import { RuntimeFetchSizeLimitError } from '../types';
import type { RuntimeProcessRunner, RuntimeProcessHandle, ToolRuntime } from '../types';

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
    // Interpreter MUST be bash: the command uses `set -o pipefail`, which /bin/sh
    // (dash, in the persona images) rejects with "Illegal option -o pipefail".
    expect(argv[0]).toBe('bash');
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

  it('passes -w with a %{stderr}-prefixed format so curl reports url_effective on stderr, not stdout', async () => {
    const raw = Buffer.from('HTTP/2 200\r\n\r\nok', 'utf8');
    const { runner, calls } = fakeRunner({ stdoutRaw: raw });
    const client = new ContainerExecNetworkClient(runner);
    await client.fetch('https://example.com', { redirect: 'follow' });
    const argv = calls[0]!;
    const wIndex = argv.indexOf('-w');
    expect(wIndex).toBeGreaterThanOrEqual(0);
    const format = argv[wIndex + 1]!;
    expect(format.startsWith('%{stderr}')).toBe(true);
    expect(format).toContain('%{url_effective}');
  });

  it("reports the redirect-following runtime's effective URL as result.url (the curl-client half of the #394 fix)", async () => {
    const raw = Buffer.from(
      'HTTP/2 301\r\nlocation: https://example.com/final\r\n\r\n' +
        'HTTP/2 200\r\ncontent-type: text/plain\r\n\r\nfinal body',
      'utf8'
    );
    const stderr = '__lace_curl_effective_url__:https://example.com/final\n';
    const { runner } = fakeRunner({ stdoutRaw: raw, stderr });
    const client = new ContainerExecNetworkClient(runner);
    const result = await client.fetch('https://example.com', { redirect: 'follow' });
    expect(result.url).toBe('https://example.com/final');
  });

  it('leaves result.url undefined when curl never reports an effective URL (no fabrication)', async () => {
    const raw = Buffer.from('HTTP/2 200\r\n\r\nok', 'utf8');
    const { runner } = fakeRunner({ stdoutRaw: raw, stderr: '' });
    const client = new ContainerExecNetworkClient(runner);
    const result = await client.fetch('https://example.com');
    expect(result.url).toBeUndefined();
  });

  it('recovers the effective URL from stdout and keeps it out of the body on curl older than 7.63', async () => {
    // curl < 7.63 doesn't know `%{stderr}`: it warns on stderr and writes the
    // REST of the write-out format to stdout, which here is the base64-framed
    // response pipe. Without handling, the marker line lands inside the body.
    const raw = Buffer.concat([
      Buffer.from('HTTP/2 200\r\ncontent-type: text/plain\r\n\r\nhello body', 'utf8'),
      Buffer.from('\n__lace_curl_effective_url__:http://127.0.0.1:8791/final\n', 'utf8'),
    ]);
    const { runner } = fakeRunner({
      stdoutRaw: raw,
      stderr: "curl: unknown --write-out variable: 'stderr'\n",
    });
    const client = new ContainerExecNetworkClient(runner);
    const result = await client.fetch('http://127.0.0.1:8791/start', { redirect: 'follow' });
    expect(Buffer.from(result.body).toString()).toBe('hello body');
    expect(result.url).toBe('http://127.0.0.1:8791/final');
  });

  it('does not count the stdout write-out trailer against maxBytes', async () => {
    const raw = Buffer.concat([
      Buffer.from('HTTP/2 200\r\n\r\n0123456789', 'utf8'),
      Buffer.from('\n__lace_curl_effective_url__:http://example.com/final\n', 'utf8'),
    ]);
    const { runner } = fakeRunner({ stdoutRaw: raw });
    const client = new ContainerExecNetworkClient(runner);
    const result = await client.fetch('http://example.com/start', {
      redirect: 'follow',
      maxBytes: 10,
    });
    expect(Buffer.from(result.body).toString()).toBe('0123456789');
  });

  it('leaves a body that merely resembles the marker mid-stream alone', async () => {
    const body = 'before\n__lace_curl_effective_url__:http://example.com/x\nafter';
    const raw = Buffer.from(`HTTP/2 200\r\n\r\n${body}`, 'utf8');
    const { runner } = fakeRunner({ stdoutRaw: raw });
    const client = new ContainerExecNetworkClient(runner);
    const result = await client.fetch('http://example.com/start', { redirect: 'follow' });
    expect(Buffer.from(result.body).toString()).toBe(body);
    expect(result.url).toBeUndefined();
  });

  it('captures an effective URL containing a space without truncating it or leaking the remainder', async () => {
    // curl echoes %{url_effective} verbatim when it rejects a malformed URL.
    const stderr =
      'curl: (3) URL rejected: Malformed input to a URL function\n' +
      '__lace_curl_effective_url__:http://127.0.0.1:32875/a b\n';
    const { runner } = fakeRunner({ exitCode: 3, stderr, stdoutRaw: Buffer.alloc(0) });
    const client = new ContainerExecNetworkClient(runner);
    const error = await client.fetch('http://127.0.0.1:32875/a b').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('URL rejected');
    expect(message).not.toContain('__lace_curl_effective_url__');
    expect(message).not.toMatch(/\bb\b/);
  });

  it('only asks curl for the effective URL when it is actually following redirects', async () => {
    const raw = Buffer.from('HTTP/2 200\r\n\r\nok', 'utf8');
    const { runner, calls } = fakeRunner({ stdoutRaw: raw });
    const client = new ContainerExecNetworkClient(runner);
    await client.fetch('https://example.com');
    expect(calls[0]).not.toContain('-w');
  });

  it('does not make url_fetch report a redirect when curl only normalized the URL', async () => {
    // curl normalizes `%{url_effective}` the same way `Response.url` does, so a
    // host-only request comes back with its path filled in. That is not a redirect.
    const raw = Buffer.from('HTTP/2 404\r\ncontent-type: text/plain\r\n\r\nnot found', 'utf8');
    const stderr = '__lace_curl_effective_url__:https://example.com/\n';
    const { runner } = fakeRunner({ stdoutRaw: raw, stderr });
    const runtime: ToolRuntime = {
      ...createFakeRuntime(),
      network: new ContainerExecNetworkClient(runner),
    };

    const result = await new UrlFetchTool().execute(
      { url: 'https://example.com' },
      { signal: new AbortController().signal, runtime }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0].text ?? '').not.toContain('Final URL:');
  });

  it('strips the effective-URL marker out of the error message on curl failure', async () => {
    const stderr =
      'curl: (6) Could not resolve host: unreachable.example\n' +
      '__lace_curl_effective_url__:http://unreachable.example/\n';
    const { runner } = fakeRunner({ exitCode: 6, stderr, stdoutRaw: Buffer.alloc(0) });
    const client = new ContainerExecNetworkClient(runner);
    await expect(client.fetch('http://unreachable.example')).rejects.toThrow(
      /Could not resolve host/
    );
    await expect(client.fetch('http://unreachable.example')).rejects.not.toThrow(
      /__lace_curl_effective_url__/
    );
  });

  describe('credential redaction in curl failures', () => {
    const SECRET = 'SECRETVALUE0123456789abcdef0123456789';

    it('does not leak the requested URL when curl fails with no stderr at all', async () => {
      // Exit code with an empty stderr falls back to the message
      // `nodeErrorFromExec` constructs, which interpolates the URL it was given.
      const { runner } = fakeRunner({ exitCode: 7, stderr: '', stdoutRaw: Buffer.alloc(0) });
      const client = new ContainerExecNetworkClient(runner);

      const error = await client
        .fetch(`https://bucket.s3.amazonaws.com/report.csv?X-Amz-Signature=${SECRET}`)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).not.toContain(SECRET);
      expect(message).toContain('X-Amz-Signature=[REDACTED]');
      expect(message).toContain('bucket.s3.amazonaws.com/report.csv');
    });

    it('redacts a credentialed URL that curl echoed back in its own stderr', async () => {
      // Verbatim curl 8.5.0 output for a URL containing an unmatched brace.
      const url = `https://example.com/{a?token=${SECRET}`;
      const stderr = `curl: (3) unmatched brace in URL position 20:\n${url}\n                   ^\n`;
      const { runner } = fakeRunner({ exitCode: 3, stderr, stdoutRaw: Buffer.alloc(0) });
      const client = new ContainerExecNetworkClient(runner);

      const error = await client.fetch(url).catch((e: unknown) => e);

      const message = (error as Error).message;
      expect(message).not.toContain(SECRET);
      expect(message).toContain('token=[REDACTED]');
      expect(message).toContain('unmatched brace in URL position 20');
    });

    it('redacts an echoed URL whose embedded space would stop a URL-shaped scan', async () => {
      const url = `http://127.0.0.1:32875/a b?code=${SECRET}`;
      const stderr = `curl: (3) unmatched brace in URL position 20:\n${url}\n`;
      const { runner } = fakeRunner({ exitCode: 3, stderr, stdoutRaw: Buffer.alloc(0) });
      const client = new ContainerExecNetworkClient(runner);

      const error = await client.fetch(url).catch((e: unknown) => e);

      const message = (error as Error).message;
      expect(message).not.toContain(SECRET);
      expect(message).toContain('code=[REDACTED]');
    });

    it('redacts the effective URL curl reports alongside its error text', async () => {
      const effective = `https://login.example.com/cb?code=${SECRET}`;
      const stderr =
        `curl: (3) unmatched brace in URL position 20:\n${effective}\n` +
        `__lace_curl_effective_url__:${effective}\n`;
      const { runner } = fakeRunner({ exitCode: 3, stderr, stdoutRaw: Buffer.alloc(0) });
      const client = new ContainerExecNetworkClient(runner);

      const error = await client
        .fetch('https://example.com/start', { redirect: 'follow' })
        .catch((e: unknown) => e);

      const message = (error as Error).message;
      expect(message).not.toContain(SECRET);
      expect(message).toContain('code=[REDACTED]');
    });

    it('leaves a curl failure with no credentials in it untouched', async () => {
      const stderr = 'curl: (6) Could not resolve host: unreachable.example\n';
      const { runner } = fakeRunner({ exitCode: 6, stderr, stdoutRaw: Buffer.alloc(0) });
      const client = new ContainerExecNetworkClient(runner);

      const error = await client
        .fetch('http://unreachable.example/docs?page=3')
        .catch((e: unknown) => e);

      expect((error as Error).message).toBe(stderr.trim());
    });
  });
});
