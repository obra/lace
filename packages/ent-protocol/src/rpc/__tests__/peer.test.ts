import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport } from '../../transport/stdio';
import { JsonRpcPeer } from '../peer';

function createPairedPeers() {
  const aToB = new PassThrough();
  const bToA = new PassThrough();

  const transportA = createNdjsonStdioTransport({ readable: bToA, writable: aToB });
  const transportB = createNdjsonStdioTransport({ readable: aToB, writable: bToA });

  const a = new JsonRpcPeer(transportA, { idPrefix: 'c_' });
  const b = new JsonRpcPeer(transportB, { idPrefix: 'a_' });

  return { a, b };
}

describe('JsonRpcPeer', () => {
  it('dispatches requests to handlers and returns results', async () => {
    const { a, b } = createPairedPeers();
    b.onRequest('ping', () => ({ ok: true }));

    await expect(a.request('ping')).resolves.toEqual({ ok: true });

    a.close();
    b.close();
  });

  it('delivers notifications without expecting a response', async () => {
    const { a, b } = createPairedPeers();
    const seen: unknown[] = [];

    b.onRequest('note', (params) => {
      seen.push(params);
      return undefined;
    });

    a.notify('note', { hello: 'world' });

    // Allow the event loop to flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(seen).toEqual([{ hello: 'world' }]);

    a.close();
    b.close();
  });
});
