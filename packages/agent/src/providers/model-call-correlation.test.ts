// ABOUTME: Exercises correlation over real SDK requests and the existing provider retry loop.
// ABOUTME: Local fake HTTP transport verifies payloads, per-call ownership and cancellation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { proxyCorrelationHeaders } from './model-call-correlation';
import { AnthropicProvider } from './anthropic-provider';
import { oneShotQuery } from '@lace/agent/conversation/one-shot-query';
import { logger } from '@lace/agent/utils/logger';
import { writeSseStream } from './__tests__/anthropic-sse-stream';

const model = 'claude-sonnet-4-6';
const messages = [{ role: 'user' as const, content: 'hello' }];
describe('model call correlation', () => {
  let server: Server;
  let url: string;
  let attempts: Array<{ headers: IncomingHttpHeaders; body: Record<string, unknown> }>;
  let failures: number;
  beforeEach(async () => {
    attempts = [];
    failures = 0;
    server = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      attempts.push({ headers: req.headers, body });
      if (failures-- > 0) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
        res.end(
          JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'fixture' } })
        );
      } else if (body.stream) {
        writeSseStream(res, model);
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'msg_fixture',
            type: 'message',
            role: 'assistant',
            model,
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 1 },
          })
        );
      }
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });
  function provider(baseURL: string | undefined = `${url}/anthropic/api.anthropic.com`) {
    const p = new AnthropicProvider({ apiKey: 'fixture-key', ...(baseURL ? { baseURL } : {}) });
    p.RETRY_CONFIG = { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 1, jitterFactor: 0 };
    p.on('error', () => {});
    return p;
  }
  function query(p: AnthropicProvider, sessionId = 'session-a', signal?: AbortSignal) {
    return oneShotQuery(
      {
        connectionId: 'fixture',
        model,
        messages,
        signal,
        correlationOwner: { sessionId, turnId: `turn-${sessionId}` },
      },
      { createProviderForTurn: async () => p }
    );
  }
  it('reuses one ID across retries and mints the next invocation independently without changing the body', async () => {
    const p = provider();
    const info = vi.spyOn(logger, 'info');
    failures = 1;
    await expect(query(p)).resolves.toMatchObject({ text: 'ok' });
    await query(p);
    await p.createStreamingResponse(messages, [], model);
    expect(attempts).toHaveLength(4);
    const ids = attempts.map((a) => a.headers['x-lace-model-call-id']);
    expect(ids[0]).toEqual(expect.any(String));
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(ids[2]).toEqual(expect.any(String));
    expect(ids[3]).toBeUndefined();
    expect(attempts.every((a) => JSON.stringify(a.body) === JSON.stringify(attempts[0].body))).toBe(
      true
    );
    expect(
      info.mock.calls.filter(([name]) => name === 'model.call').map(([, data]) => data)
    ).toEqual([
      { sessionId: 'session-a', turnId: 'turn-session-a', modelCallId: ids[0] },
      { sessionId: 'session-a', turnId: 'turn-session-a', modelCallId: ids[2] },
    ]);
  });
  it('uses request-specific headers on a cached SDK client for concurrent sessions', async () => {
    const p = provider();
    await Promise.all([query(p, 'root'), query(p, 'arbiter')]);
    expect(new Set(attempts.map((a) => a.headers['x-lace-session-id']))).toEqual(
      new Set(['root', 'arbiter'])
    );
    expect(new Set(attempts.map((a) => a.headers['x-lace-model-call-id'])).size).toBe(2);
    for (const a of attempts)
      expect(a.headers['x-lace-turn-id']).toBe(`turn-${a.headers['x-lace-session-id']}`);
  });
  it('uses the SDK effective environment base URL and adds headers to nonstreaming calls too', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', `${url}/anthropic/api.anthropic.com`);
    const p = provider('');
    await p.createResponse(messages, [], model, undefined, undefined, {
      correlation: { sessionId: 's', turnId: 't', modelCallId: 'c' },
    });
    expect(attempts[0].headers['x-lace-model-call-id']).toBe('c');
    expect(attempts[0].headers['x-lace-session-id']).toBe('s');
  });
  it('omits internal headers for a direct provider path', async () => {
    await query(provider(url));
    expect(Object.keys(attempts[0].headers).filter((k) => k.startsWith('x-lace-'))).toEqual([]);
  });
  it('does not turn a diagnostic write failure into a failed or retried model request', async () => {
    const original = logger.info.bind(logger);
    vi.spyOn(logger, 'info').mockImplementation((name, data) => {
      if (name === 'model.call') throw new Error('diagnostic sink unavailable');
      original(name, data);
    });
    await expect(query(provider())).resolves.toMatchObject({ text: 'ok' });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].headers['x-lace-model-call-id']).toEqual(expect.any(String));
  });
  it('preserves cancellation and retry limits', async () => {
    const p = provider();
    const controller = new AbortController();
    controller.abort();
    await expect(query(p, 'cancelled', controller.signal)).rejects.toThrow();
    expect(attempts).toHaveLength(0);
    failures = 3;
    await expect(query(p)).rejects.toThrow();
    expect(attempts).toHaveLength(2);
    expect(attempts[0].headers['x-lace-model-call-id']).toEqual(expect.any(String));
    expect(attempts[1].headers['x-lace-model-call-id']).toBe(
      attempts[0].headers['x-lace-model-call-id']
    );
  });
});

describe('proxy correlation destination boundary', () => {
  const correlation = { sessionId: 's', turnId: 't', modelCallId: 'm' };
  it.each([
    'http://localhost:8080/anthropic/api.anthropic.com',
    'http://127.0.0.1/anthropic/api.anthropic.com/',
    'http://[::1]:8080/anthropic/api.anthropic.com',
  ])('uses the existing local route %s', (url) => {
    expect(proxyCorrelationHeaders(url, correlation)).toEqual({
      'X-Lace-Session-Id': 's',
      'X-Lace-Turn-Id': 't',
      'X-Lace-Model-Call-Id': 'm',
    });
  });
  it.each([
    'https://api.anthropic.com',
    'https://localhost/anthropic/api.anthropic.com',
    'http://remote.example/anthropic/api.anthropic.com',
    'http://localhost/bedrock',
    'http://localhost/anthropic',
    'http://localhost/anthropic/api.anthropic.com/extra',
    'not a URL',
  ])('does not forward IDs to %s', (url) => {
    expect(proxyCorrelationHeaders(url, correlation)).toEqual({});
  });
});
