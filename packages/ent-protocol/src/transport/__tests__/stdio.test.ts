import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport } from '../stdio';

describe('createNdjsonStdioTransport', () => {
  it('parses newline-delimited JSON-RPC messages across chunk boundaries', () => {
    const readable = new PassThrough();
    const writable = new PassThrough();

    const transport = createNdjsonStdioTransport({ readable, writable });

    const received: unknown[] = [];
    transport.onMessage((msg) => received.push(msg));

    readable.write('{"jsonrpc":"2.0","method":"session/update","params":{"a":1}}');
    expect(received).toHaveLength(0);

    readable.write('\n{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    expect(received).toHaveLength(1);

    readable.write('\n');
    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({ jsonrpc: '2.0', method: 'session/update' });
    expect(received[1]).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  });

  it('writes JSON-RPC messages as single-line NDJSON', async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();

    const transport = createNdjsonStdioTransport({ readable, writable });

    transport.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

    const out = await new Promise<string>((resolve) => {
      writable.once('data', (chunk) => resolve(chunk.toString('utf8')));
    });

    expect(out).toBe('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
  });
});
