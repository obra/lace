// ABOUTME: Smoke test for the STREAMING path — captures the actual HTTP body
// that AnthropicProvider.createStreamingResponse sends and asserts the
// cache_control breakpoints land in the same positions as the non-streaming
// path. (Adversarial review found this path was untested at the wire layer.)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AnthropicProvider } from '../anthropic-provider';
import { Tool } from '@lace/agent/tools/tool';
import { z } from 'zod';
import type { ToolContext, ToolResult } from '@lace/agent/tools/types';
import { writeSseStream } from './anthropic-sse-stream';
import { ANCHOR_OFFSET_RAW_BLOCKS } from '../cache-control';

class EchoTool extends Tool {
  name = 'echo';
  description = 'Echo a value';
  schema = z.object({ v: z.string() });
  protected async executeValidated(
    args: { v: string },
    _context: ToolContext
  ): Promise<ToolResult> {
    return await Promise.resolve(this.createResult(args.v));
  }
}

class SearchTool extends Tool {
  name = 'search';
  description = 'Search for information';
  schema = z.object({ q: z.string() });
  protected async executeValidated(
    args: { q: string },
    _context: ToolContext
  ): Promise<ToolResult> {
    return await Promise.resolve(this.createResult(args.q));
  }
}

interface RequestBody {
  system?: Array<{ cache_control?: unknown }>;
  tools?: Array<{ cache_control?: unknown }>;
  messages: Array<{ role: string; content: unknown }>;
}

describe('streaming smoke — cache_control on the stream path', () => {
  let server: Server;
  let baseURL: string;
  const captured: { body: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        captured.push({ body });
        writeSseStream(res);
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    baseURL = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  it('streaming request body has the same cache_control markers as non-streaming', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test', baseURL });
    provider.setSystemPrompt('You are an agentic assistant.');

    // Round-trips sized off ANCHOR_OFFSET_RAW_BLOCKS with headroom (PRI-1821
    // review finding 6) — enough cacheable blocks to trigger the stable
    // anchor, producing 4 total cache_control markers: system + last-tool +
    // anchor + tail. A count pinned to one offset value silently loses the
    // anchor the next time the constant grows.
    const roundTrips = Math.ceil(ANCHOR_OFFSET_RAW_BLOCKS / 4) + 2;
    const messages: Parameters<typeof provider.createStreamingResponse>[0] = [];
    for (let i = 0; i < roundTrips; i++) {
      messages.push({ role: 'user', content: `q${i}` });
      messages.push({
        role: 'assistant',
        content: `ok ${i}`,
        toolCalls: [{ id: `t${i}`, name: 'echo', arguments: { v: `${i}` } }],
      });
      messages.push({
        role: 'user',
        content: '',
        toolResults: [
          {
            id: `t${i}`,
            content: [{ type: 'text' as const, text: `r${i}` }],
            status: 'completed' as const,
          },
        ],
      });
    }
    messages.push({ role: 'user', content: 'final' });

    // createStreamingResponse returns a Promise<ProviderResponse> that resolves
    // once the stream is fully consumed via stream.finalMessage().
    await provider.createStreamingResponse(
      messages,
      [new EchoTool(), new SearchTool()],
      'claude-sonnet-4-20250514'
    );

    expect(captured).toHaveLength(1);
    const body = JSON.parse(captured[0].body) as RequestBody;

    // ── 1. system block has cache_control with 1h ttl ───────────────────────
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system![0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });

    // ── 2. last tool has cache_control with 1h ttl ──────────────────────────
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools!.length).toBeGreaterThan(0);
    const lastTool = body.tools![body.tools!.length - 1];
    expect(lastTool.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });

    // First tool must NOT have cache_control
    expect(body.tools![0].cache_control).toBeUndefined();

    // ── 3. total cache_control marker count: 4 (system + last-tool + anchor + tail)
    //    This conversation has `roundTrips` rounds of 4 blocks each plus a
    //    final message, sized (with headroom) to exceed
    //    ANCHOR_OFFSET_RAW_BLOCKS, so the stable anchor fires.
    const total = (JSON.stringify(body).match(/"cache_control"/g) ?? []).length;
    expect(total).toBe(4);

    const oneHourMarkers = (JSON.stringify(body).match(/"ttl":"1h"/g) ?? []).length;
    expect(oneHourMarkers).toBe(4);
  });
});
