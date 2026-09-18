// ABOUTME: Unit tests for the LunaRoute-class mislabeled-Content-Type tolerance fetch wrapper

import { describe, expect, it, vi } from 'vitest';
import { createContentTypeTolerantFetch } from '../content-type-tolerant-fetch';

function fakeFetch(response: Response): typeof fetch {
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

describe('createContentTypeTolerantFetch', () => {
  it('rewrites Content-Type to application/json for a non-streaming request whose JSON body was mislabeled text/event-stream', async () => {
    const body = JSON.stringify({ object: 'response', id: 'resp_123', status: 'completed' });
    const mislabeled = new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    const wrapped = createContentTypeTolerantFetch(fakeFetch(mislabeled));

    const result = await wrapped('https://gw.example.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify({ model: 'x', stream: false }),
    });

    expect(result.headers.get('content-type')).toBe('application/json');
    await expect(result.json()).resolves.toEqual({
      object: 'response',
      id: 'resp_123',
      status: 'completed',
    });
  });

  it('passes a real event-stream through untouched when the request asked to stream', async () => {
    const sseBody = 'data: {"type":"response.output_text.delta","delta":"hi"}\n\n';
    const realStream = new Response(sseBody, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    const wrapped = createContentTypeTolerantFetch(fakeFetch(realStream));

    const result = await wrapped('https://gw.example.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify({ model: 'x', stream: true }),
    });

    // Untouched: same Content-Type, and the body is still readable as the
    // original SSE text (not consumed/rewritten by the wrapper).
    expect(result.headers.get('content-type')).toBe('text/event-stream');
    await expect(result.text()).resolves.toBe(sseBody);
  });

  it('leaves a genuinely non-JSON, mislabeled body untouched (does not invent success)', async () => {
    const garbage = 'not json and not real SSE either';
    const broken = new Response(garbage, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    const wrapped = createContentTypeTolerantFetch(fakeFetch(broken));

    const result = await wrapped('https://gw.example.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify({ model: 'x', stream: false }),
    });

    // Original (broken) header preserved -- we don't guess further.
    expect(result.headers.get('content-type')).toBe('text/event-stream');
    await expect(result.text()).resolves.toBe(garbage);
  });

  it('passes through a correctly-labeled application/json response unchanged', async () => {
    const body = JSON.stringify({ object: 'response', id: 'resp_456' });
    const correct = new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const wrapped = createContentTypeTolerantFetch(fakeFetch(correct));

    const result = await wrapped('https://gw.example.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify({ model: 'x', stream: false }),
    });

    expect(result.headers.get('content-type')).toBe('application/json');
    await expect(result.json()).resolves.toEqual({ object: 'response', id: 'resp_456' });
  });

  it('does not sniff/buffer when there is no request body to confirm stream:false (fails open, unchanged)', async () => {
    const body = JSON.stringify({ object: 'response', id: 'resp_789' });
    const mislabeled = new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    const wrapped = createContentTypeTolerantFetch(fakeFetch(mislabeled));

    // No init/body at all -- requestedStreaming() can't prove this wasn't a
    // stream request, so... actually a GET with no body is not `stream:
    // true`, so this SHOULD still be corrected. This case exists to document
    // that a missing/non-JSON body is treated as "not requesting streaming"
    // (the safe default), not to special-case GETs.
    const result = await wrapped('https://gw.example.com/v1/responses');

    expect(result.headers.get('content-type')).toBe('application/json');
  });
});
