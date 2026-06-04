// ABOUTME: Smoke probe — captures the actual HTTP body the
// AnthropicProvider sends, asserts three 1h cache_control breakpoints in the
// wire payload (system + last tool + last message block), and writes the
// captured body to a file so it can be eyeballed.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnthropicProvider } from '../anthropic-provider';
import { Tool } from '@lace/agent/tools/tool';
import { ToolResult, ToolContext } from '@lace/agent/tools/types';
import { z } from 'zod';

type CapturedRequest = { body: string };

interface RequestBody {
  system?: Array<{ type: string; text: string; cache_control?: unknown }>;
  tools?: Array<{ name: string; cache_control?: unknown }>;
  messages: Array<{
    role: string;
    content:
      | string
      | Array<{ type: string; text?: string; cache_control?: unknown; [k: string]: unknown }>;
  }>;
}

class EchoTool extends Tool {
  name = 'echo';
  description = 'Echo a value';
  schema = z.object({ value: z.string() });
  protected async executeValidated(
    args: { value: string },
    _context: ToolContext
  ): Promise<ToolResult> {
    return await Promise.resolve(this.createResult(args.value));
  }
}

class FetchUrlTool extends Tool {
  name = 'fetch_url';
  description = 'Fetch a URL';
  schema = z.object({ url: z.string() });
  protected async executeValidated(
    args: { url: string },
    _context: ToolContext
  ): Promise<ToolResult> {
    return await Promise.resolve(this.createResult(args.url));
  }
}

describe('smoke: real outgoing request body has three 1h cache_control markers', () => {
  let server: Server;
  let baseURL: string;
  const captured: CapturedRequest[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        captured.push({ body });
        // Return a minimal valid Anthropic response so the SDK doesn't throw.
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'msg_smoke',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-20250514',
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
              input_tokens: 10,
              output_tokens: 2,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          })
        );
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    baseURL = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  it('sends three cache_control 1h breakpoints on the wire', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test-key', baseURL });
    provider.setSystemPrompt('You are Ada. The conversation prefix here is what we are caching.');

    // A realistic multi-turn conversation with a tool call/result and a fresh
    // user follow-up — mirrors the pattern that re-bills 600k tokens on Ada.
    const messages = [
      { role: 'user' as const, content: 'Hi Ada' },
      { role: 'assistant' as const, content: 'Hello, how can I help?' },
      { role: 'user' as const, content: 'Look something up' },
      {
        role: 'assistant' as const,
        content: '',
        toolCalls: [
          { id: 'toolu_smoke_1', name: 'fetch_url', arguments: { url: 'https://example.com' } },
        ],
      },
      {
        role: 'user' as const,
        content: '',
        toolResults: [
          {
            id: 'toolu_smoke_1',
            content: [{ type: 'text' as const, text: 'fetched body' }],
            status: 'completed' as const,
          },
        ],
      },
      { role: 'user' as const, content: 'Now summarise it.' },
    ];

    await provider.createResponse(
      messages,
      [new EchoTool(), new FetchUrlTool()],
      'claude-sonnet-4-20250514'
    );

    expect(captured).toHaveLength(1);
    const body = JSON.parse(captured[0].body) as RequestBody;

    // Write the captured body for human inspection / reproducibility.
    const outDir = join(tmpdir(), 'pri-1799-smoke');
    mkdirSync(outDir, { recursive: true });
    const outFile = join(outDir, `request-${Date.now()}.json`);
    writeFileSync(outFile, JSON.stringify(body, null, 2));
    console.log(`[smoke] captured request body written to ${outFile}`);

    // ── 1. system block has cache_control with 1h ttl ───────────────────
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system).toHaveLength(1);
    expect(body.system![0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });

    // ── 2. last tool has cache_control with 1h ttl ──────────────────────
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools!.length).toBeGreaterThan(0);
    const lastTool = body.tools![body.tools!.length - 1];
    expect(lastTool.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });

    // First (non-last) tool must NOT have cache_control
    expect(body.tools![0].cache_control).toBeUndefined();

    // ── 3. last message's last block has cache_control with 1h ttl ──────
    const lastMessage = body.messages[body.messages.length - 1];
    expect(Array.isArray(lastMessage.content)).toBe(true);
    const lastBlocks = lastMessage.content as Array<{
      type: string;
      text?: string;
      cache_control?: unknown;
    }>;
    const lastBlock = lastBlocks[lastBlocks.length - 1];
    expect(lastBlock.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(lastBlock.type).toBe('text');
    expect(lastBlock.text).toBe('Now summarise it.');

    // ── Count: exactly three cache_control markers in the whole body ────
    // This conversation has 7 cacheable blocks — fewer than
    // ANCHOR_OFFSET_RAW_BLOCKS (10), so no stable anchor is attached and
    // the total is system + last-tool + tail = 3. See the 1802 smoke
    // for the long-conversation 4-marker case.
    const allMarkers = JSON.stringify(body).match(/"cache_control"/g) ?? [];
    expect(allMarkers).toHaveLength(3);
    const oneHourMarkers = JSON.stringify(body).match(/"ttl":"1h"/g) ?? [];
    expect(oneHourMarkers).toHaveLength(3);

    // ── Earlier messages: no cache_control anywhere ─────────────────────
    for (const msg of body.messages.slice(0, -1)) {
      const json = JSON.stringify(msg);
      expect(json.includes('cache_control')).toBe(false);
    }
  });
});
