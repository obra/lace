// ABOUTME: PRI-1802 smoke probe — sends two consecutive requests through the
// AnthropicProvider (turn 1, then turn 2 with several added tool round-trips)
// and asserts the structural property that makes the stable-anchor pattern
// pay off: turn 2's tail breakpoint stays within Anthropic's 20-block
// lookback of turn 1's tail breakpoint, AND turn 2's stable-anchor
// breakpoint lands on a block that was unchanged from turn 1.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnthropicProvider } from '../anthropic-provider';
import { Tool } from '@lace/agent/tools/tool';
import { ToolResult, ToolContext } from '@lace/agent/tools/types';
import { z } from 'zod';

const ANTHROPIC_LOOKBACK_BLOCKS = 20;

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

class ToolA extends Tool {
  name = 'tool_a';
  description = 'Tool A';
  schema = z.object({ x: z.string() });
  protected async executeValidated(
    args: { x: string },
    _context: ToolContext
  ): Promise<ToolResult> {
    return await Promise.resolve(this.createResult(args.x));
  }
}

class ToolB extends Tool {
  name = 'tool_b';
  description = 'Tool B';
  schema = z.object({ y: z.string() });
  protected async executeValidated(
    args: { y: string },
    _context: ToolContext
  ): Promise<ToolResult> {
    return await Promise.resolve(this.createResult(args.y));
  }
}

// Flatten messages into a list of content blocks (in send order) so we can
// reason about block-level positions the way Anthropic's cache does.
function flattenBlocks(body: RequestBody): Array<{
  msgIdx: number;
  blockIdx: number;
  type: string;
  cache_control: unknown;
  serialized: string;
}> {
  const out: ReturnType<typeof flattenBlocks> = [];
  body.messages.forEach((msg, mi) => {
    const arr = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }];
    arr.forEach((b, bi) => {
      const block = b as { type: string; cache_control?: unknown };
      out.push({
        msgIdx: mi,
        blockIdx: bi,
        type: block.type,
        cache_control: block.cache_control,
        serialized: JSON.stringify(b),
      });
    });
  });
  return out;
}

describe('PRI-1802 smoke: two-turn structural cache property', () => {
  let server: Server;
  let baseURL: string;
  const captured: Array<{ body: string }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        captured.push({ body });
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
            usage: {
              input_tokens: 10,
              output_tokens: 2,
              // Pretend turn 1 wrote cache, turn 2 read it. Pure theatre —
              // the real assertion is structural, not semantic.
              cache_creation_input_tokens: captured.length === 1 ? 1000 : 100,
              cache_read_input_tokens: captured.length === 1 ? 0 : 900,
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

  it('keeps turn-2 tail within 20 blocks of turn-1 tail AND anchors on unchanged history', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test', baseURL });
    provider.setSystemPrompt('You are an agentic assistant doing many tool calls.');

    // Turn 1: 6 tool round-trips followed by a user question. That's enough
    // cacheable blocks (>10) to force a stable anchor.
    const turn1: Parameters<typeof provider.createResponse>[0] = [];
    for (let i = 0; i < 6; i++) {
      turn1.push({ role: 'user', content: `step ${i} please` });
      turn1.push({
        role: 'assistant',
        content: `okay, doing step ${i}`,
        toolCalls: [{ id: `t${i}`, name: 'tool_a', arguments: { x: `${i}` } }],
      });
      turn1.push({
        role: 'user',
        content: '',
        toolResults: [
          {
            id: `t${i}`,
            content: [{ type: 'text' as const, text: `result ${i}` }],
            status: 'completed' as const,
          },
        ],
      });
    }
    turn1.push({ role: 'user', content: 'Summarise so far.' });

    await provider.createResponse(turn1, [new ToolA(), new ToolB()], 'claude-sonnet-4-20250514');

    // Turn 2: same history plus two additional tool round-trips and a new
    // user question. Mirrors how the next agent cycle would look.
    const turn2 = [
      ...turn1,
      { role: 'assistant' as const, content: 'Here is my summary.' },
      {
        role: 'assistant' as const,
        content: 'doing one more thing',
        toolCalls: [{ id: 't_new1', name: 'tool_b', arguments: { y: 'extra' } }],
      },
      {
        role: 'user' as const,
        content: '',
        toolResults: [
          {
            id: 't_new1',
            content: [{ type: 'text' as const, text: 'extra-result' }],
            status: 'completed' as const,
          },
        ],
      },
      { role: 'user' as const, content: 'Now finalise it.' },
    ];

    await provider.createResponse(turn2, [new ToolA(), new ToolB()], 'claude-sonnet-4-20250514');

    expect(captured).toHaveLength(2);
    const body1 = JSON.parse(captured[0].body) as RequestBody;
    const body2 = JSON.parse(captured[1].body) as RequestBody;

    // Dump for inspection
    const outDir = join(tmpdir(), 'pri-1802-smoke');
    mkdirSync(outDir, { recursive: true });
    const ts = Date.now();
    writeFileSync(join(outDir, `turn1-${ts}.json`), JSON.stringify(body1, null, 2));
    writeFileSync(join(outDir, `turn2-${ts}.json`), JSON.stringify(body2, null, 2));

    console.log(`[PRI-1802 smoke] dumps written to ${outDir} with timestamp ${ts}`);

    // ── Sanity: each turn has system + last-tool + 2 message breakpoints
    const total = (b: RequestBody) => (JSON.stringify(b).match(/"cache_control"/g) ?? []).length;
    expect(total(body1)).toBe(4);
    expect(total(body2)).toBe(4);

    // ── Thinking blocks never carry cache_control ────────────────────────
    for (const body of [body1, body2]) {
      for (const block of flattenBlocks(body)) {
        if (block.type === 'thinking' || block.type === 'redacted_thinking') {
          expect(block.cache_control).toBeUndefined();
        }
      }
    }

    // ── Locate message-level breakpoints in turn 1 ───────────────────────
    const flat1 = flattenBlocks(body1).filter(
      (b) => b.type !== 'thinking' && b.type !== 'redacted_thinking'
    );
    const flat2 = flattenBlocks(body2).filter(
      (b) => b.type !== 'thinking' && b.type !== 'redacted_thinking'
    );

    const marked1 = flat1.filter((b) => b.cache_control !== undefined);
    const marked2 = flat2.filter((b) => b.cache_control !== undefined);
    expect(marked1).toHaveLength(2); // anchor + tail
    expect(marked2).toHaveLength(2);

    const [anchor1, tail1] = marked1;
    const [anchor2, tail2] = marked2;

    // All four are 1h
    for (const m of [anchor1, tail1, anchor2, tail2]) {
      expect(m.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    }

    // ── Anchor stability: turn-2 anchor block must exist verbatim somewhere
    //    in turn 1 (it's a piece of unchanged history). Without that,
    //    Anthropic's prefix matcher can't reuse a prior cache entry.
    const turn1Serialized = flat1.map((b) => stripCacheControl(b.serialized));
    expect(turn1Serialized).toContain(stripCacheControl(anchor2.serialized));

    // ── Lookback property: turn-2's TAIL must sit within 20 blocks of where
    //    turn-1's TAIL sat in the SHARED prefix. Equivalent assertion: the
    //    number of NEW blocks between turn-1's tail position and turn-2's
    //    tail position must be < 20. If this fails, the next request's
    //    breakpoint can't see the prior write, and we re-bill the prefix.
    const tail1PrefixIndex = flat1.findIndex(
      (b) => b.msgIdx === tail1.msgIdx && b.blockIdx === tail1.blockIdx
    );
    const tail2PrefixIndex = flat2.findIndex(
      (b) => b.msgIdx === tail2.msgIdx && b.blockIdx === tail2.blockIdx
    );
    const blocksAddedBetweenTurns = tail2PrefixIndex - tail1PrefixIndex;
    expect(blocksAddedBetweenTurns).toBeGreaterThan(0);
    expect(blocksAddedBetweenTurns).toBeLessThan(ANTHROPIC_LOOKBACK_BLOCKS);

    // ── Belt-and-braces: turn-2's anchor sits BEHIND turn-2's tail, and
    //    within the lookback window of turn-2's tail.
    const anchor2Index = flat2.findIndex(
      (b) => b.msgIdx === anchor2.msgIdx && b.blockIdx === anchor2.blockIdx
    );
    expect(anchor2Index).toBeLessThan(tail2PrefixIndex);
    expect(tail2PrefixIndex - anchor2Index).toBeLessThanOrEqual(ANTHROPIC_LOOKBACK_BLOCKS);
  });
});

function stripCacheControl(serialized: string): string {
  // Remove any cache_control field from a serialized block so equality
  // comparisons across turns aren't tripped by the marker we just stamped.
  return serialized.replace(/,?"cache_control":\{[^}]*\}/, '');
}
