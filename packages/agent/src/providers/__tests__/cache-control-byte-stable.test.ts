// ABOUTME: Asserts that two consecutive provider requests with the same
// session-foundational state produce byte-identical message PREFIXES.
// This is the core property that makes caching useful — any future
// regression that introduces nondeterminism in the messages array (e.g.
// a re-run of variable providers, a non-byte-stable sort, a timestamp
// embedded in a tool description) would silently bust cache without
// breaking any other test. This test catches it.

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

describe('message prefix is byte-stable across consecutive turns', () => {
  let server: Server;
  let baseURL: string;
  const captured: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        captured.push(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: `msg_${captured.length}`,
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-20250514',
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          })
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    baseURL = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
  });

  it('shared message prefix is byte-identical across two consecutive turns (only the tail changes)', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test', baseURL });
    provider.setSystemPrompt('You are Lace. Cached system block.');

    const baseHistory = [
      { role: 'user' as const, content: 'turn 1 question' },
      { role: 'assistant' as const, content: 'turn 1 answer' },
      { role: 'user' as const, content: 'turn 2 question' },
      { role: 'assistant' as const, content: 'turn 2 answer' },
    ];

    // Turn 1: history + one new user message
    await provider.createResponse(
      [...baseHistory, { role: 'user', content: 'NEW question 1' }],
      [new EchoTool()],
      'claude-sonnet-4-20250514'
    );

    // Turn 2: history + previous turn's "answer" + another new user message
    await provider.createResponse(
      [
        ...baseHistory,
        { role: 'user', content: 'NEW question 1' },
        { role: 'assistant', content: 'NEW answer 1' },
        { role: 'user', content: 'NEW question 2' },
      ],
      [new EchoTool()],
      'claude-sonnet-4-20250514'
    );

    expect(captured).toHaveLength(2);
    const body1 = JSON.parse(captured[0]) as {
      system: unknown;
      tools: unknown;
      messages: unknown[];
    };
    const body2 = JSON.parse(captured[1]) as {
      system: unknown;
      tools: unknown;
      messages: unknown[];
    };

    // system block must be byte-identical
    expect(JSON.stringify(body1.system)).toBe(JSON.stringify(body2.system));

    // tools array must be byte-identical
    expect(JSON.stringify(body1.tools)).toBe(JSON.stringify(body2.tools));

    // Shared message prefix: first 4 messages (baseHistory) are shared.
    // Strip cache_control because the tail moves between requests.
    const stripCacheControl = (s: string) => s.replace(/,?"cache_control":\{[^}]*\}/g, '');

    const sharedCount = baseHistory.length; // = 4
    const prefix1 = JSON.stringify(body1.messages.slice(0, sharedCount));
    const prefix2 = JSON.stringify(body2.messages.slice(0, sharedCount));
    expect(stripCacheControl(prefix1)).toBe(stripCacheControl(prefix2));
  });
});
