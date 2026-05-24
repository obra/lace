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

// Build and write a minimal SSE stream that the Anthropic SDK can fully consume.
// The SDK's messages.stream() requires: message_start → content_block_start →
// content_block_delta → content_block_stop → message_delta → message_stop.
function writeSseStream(res: import('node:http').ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });

  const send = (event: string, data: object) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_smoke_stream',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  });

  send('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  });

  send('content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'ok' },
  });

  send('content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  });

  send('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 1 },
  });

  send('message_stop', { type: 'message_stop' });

  res.end();
}

describe('PRI-1799/streaming smoke — cache_control on the stream path', () => {
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

    // 6 tool round-trips = enough cacheable blocks (>10) to trigger the stable
    // anchor, producing 4 total cache_control markers: system + last-tool + anchor + tail.
    const messages: Parameters<typeof provider.createStreamingResponse>[0] = [];
    for (let i = 0; i < 6; i++) {
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
    //    This conversation has 25 cacheable blocks (system + 6 rounds of 4 blocks each + final),
    //    which exceeds ANCHOR_OFFSET_RAW_BLOCKS (10), so the stable anchor fires.
    const total = (JSON.stringify(body).match(/"cache_control"/g) ?? []).length;
    expect(total).toBe(4);

    const oneHourMarkers = (JSON.stringify(body).match(/"ttl":"1h"/g) ?? []).length;
    expect(oneHourMarkers).toBe(4);
  });
});
