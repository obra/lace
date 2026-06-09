// ABOUTME: RuntimeNetworkClient implemented by shelling stock curl through a brokered process runner.
// ABOUTME: curl -i output is piped through base64 so headers+body arrive as one byte-safe stdout stream.

import {
  RuntimeFetchSizeLimitError,
  type RuntimeFetchOptions,
  type RuntimeFetchResult,
  type RuntimeNetworkClient,
  type RuntimeProcessRunner,
} from './types';
import { nodeErrorFromExec, streamToString, writeStreamAndClose } from './container-exec-shared';

const DEFAULT_FETCH_TIMEOUT_SECS = 120;

export class ContainerExecNetworkClient implements RuntimeNetworkClient {
  constructor(private readonly process: RuntimeProcessRunner) {}

  async fetch(url: string, opts?: RuntimeFetchOptions): Promise<RuntimeFetchResult> {
    const method = opts?.method ?? 'GET';
    const redirect = opts?.redirect ?? 'manual';
    const hasBody = opts?.body !== undefined;

    const headerArgs: string[] = [];
    for (const [key, value] of Object.entries(opts?.headers ?? {})) {
      headerArgs.push('-H', `${key}: ${value}`);
    }

    // `sh -c 'curl "$@" | base64 -w0' curl ...args` passes url/headers as curl's
    // positional $@ — no shell interpolation, so they cannot be injected. pipefail
    // propagates curl's exit code through the base64 pipe.
    const argv = [
      'sh',
      '-c',
      'set -o pipefail; curl "$@" | base64 -w0',
      'curl',
      '-sS',
      '-i',
      '--max-time',
      String(DEFAULT_FETCH_TIMEOUT_SECS),
      '-X',
      method,
      ...(redirect === 'follow' ? ['-L'] : []),
      ...headerArgs,
      ...(hasBody ? ['--data-binary', '@-'] : []),
      url,
    ];

    const handle = await this.process.start(argv, { signal: opts?.signal });

    if (handle.stdin) {
      if (hasBody) {
        await writeStreamAndClose(handle.stdin, opts!.body!);
      } else {
        handle.stdin.end();
      }
    }

    // Drain both pipes concurrently with completion; reading after completion can
    // deadlock on a full pipe buffer.
    const [stdout, stderr, completion] = await Promise.all([
      streamToString(handle.stdout),
      streamToString(handle.stderr),
      handle.completion,
    ]);

    if (completion.exitCode !== 0) {
      throw nodeErrorFromExec(completion.exitCode ?? -1, stderr, 'fetch', url);
    }

    const raw = Buffer.from(stdout, 'base64');
    const { headerText, body } = splitHeadersAndBody(raw);
    const { status, headers } = parseHeaderBlock(headerText);

    if (opts?.maxBytes !== undefined && body.byteLength > opts.maxBytes) {
      throw new RuntimeFetchSizeLimitError(opts.maxBytes, body.byteLength);
    }

    return { status, headers, body: new Uint8Array(body) };
  }
}

/** Locate the final header/body boundary, skipping stacked redirect header blocks
 * (each begins with an `HTTP/` status line). Returns ASCII header text plus the
 * raw body bytes after the last boundary. */
function splitHeadersAndBody(raw: Buffer): { headerText: string; body: Buffer } {
  const crlf = Buffer.from('\r\n\r\n');
  const lf = Buffer.from('\n\n');

  let searchFrom = 0;
  let boundaryStart = -1;
  let boundaryLen = 0;

  for (;;) {
    let idx = raw.indexOf(crlf, searchFrom);
    let len = crlf.length;
    if (idx === -1) {
      idx = raw.indexOf(lf, searchFrom);
      len = lf.length;
    }
    if (idx === -1) break;

    boundaryStart = idx;
    boundaryLen = len;

    // If the bytes after this boundary start another HTTP status line, this was an
    // intermediate (redirect) header block — keep scanning for the next boundary.
    const afterBoundary = idx + len;
    if (raw.slice(afterBoundary, afterBoundary + 5).toString('ascii') === 'HTTP/') {
      searchFrom = afterBoundary;
      continue;
    }
    break;
  }

  if (boundaryStart === -1) {
    return { headerText: raw.toString('utf8'), body: Buffer.alloc(0) };
  }

  return {
    headerText: raw.slice(0, boundaryStart).toString('utf8'),
    body: raw.slice(boundaryStart + boundaryLen),
  };
}

/** Parse a single (final) header block: first line `HTTP/x N ...` then `Key: Value`. */
function parseHeaderBlock(headerText: string): {
  status: number;
  headers: Record<string, string>;
} {
  const lines = headerText.split(/\r?\n/).filter((line) => line.length > 0);

  // Only the final header block matters; if intermediate blocks bled through, take
  // the last status line as the start of the final block.
  let startIndex = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.startsWith('HTTP/')) {
      startIndex = i;
      break;
    }
  }

  const statusLine = lines[startIndex] ?? '';
  const statusToken = statusLine.split(/\s+/)[1] ?? '';
  const status = parseInt(statusToken, 10);

  const headers: Record<string, string> = {};
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).toLowerCase().trim();
    const value = line.slice(sep + 1).trim();
    headers[key] = value;
  }

  return { status, headers };
}
