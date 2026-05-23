// ABOUTME: Unit tests for the shared cache-control module — covers raw-block
// anchor math (PRI-1805), block-type whitelist (PRI-1806 #5), and the
// 4-marker budget cap (PRI-1806 #1).

import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  ANCHOR_OFFSET_RAW_BLOCKS,
  MAX_CACHE_BREAKPOINTS,
  attachMessageCacheBreakpoints,
  bedrockCacheTtlFor,
  buildSystemWithCaching,
  countCacheBreakpoints,
  enforceBreakpointBudget,
  markLastToolForCaching,
} from '../cache-control';

const OPTIONS_1H = { ttl: '1h' as const };
const OPTIONS_5M = { ttl: '5m' as const };
const MARKER_1H = { type: 'ephemeral', ttl: '1h' };
const MARKER_5M = { type: 'ephemeral', ttl: '5m' };

// Helpers that build raw Anthropic.MessageParam fixtures with whatever block
// types we want — including thinking blocks the ProviderMessage layer can't
// express.
function user(...blocks: Anthropic.ContentBlockParam[]): Anthropic.MessageParam {
  return { role: 'user', content: blocks };
}
function assistant(...blocks: Anthropic.ContentBlockParam[]): Anthropic.MessageParam {
  return { role: 'assistant', content: blocks };
}
function text(t: string): Anthropic.TextBlockParam {
  return { type: 'text', text: t };
}
function tool_use(id: string, name = 'tool', input: object = {}): Anthropic.ToolUseBlockParam {
  return { type: 'tool_use', id, name, input };
}
function tool_result(id: string, content: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: id, content };
}
function thinking(t: string): Anthropic.ThinkingBlockParam {
  return { type: 'thinking', signature: 'sig', thinking: t };
}

function flattenBlocks(messages: Anthropic.MessageParam[]) {
  const out: Array<{ type: string; cache_control: unknown; rawIdx: number }> = [];
  let i = 0;
  for (const m of messages) {
    const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
    for (const b of blocks) {
      out.push({
        type: (b as { type: string }).type,
        cache_control: (b as { cache_control?: unknown }).cache_control,
        rawIdx: i++,
      });
    }
  }
  return out;
}

describe('buildSystemWithCaching', () => {
  it('wraps string into a single text block with the right ttl', () => {
    expect(buildSystemWithCaching('hello', OPTIONS_1H)).toEqual([
      { type: 'text', text: 'hello', cache_control: MARKER_1H },
    ]);
    expect(buildSystemWithCaching('hello', OPTIONS_5M)).toEqual([
      { type: 'text', text: 'hello', cache_control: MARKER_5M },
    ]);
  });
});

describe('markLastToolForCaching', () => {
  it('stamps only the last tool, leaves others untouched', () => {
    const tools = [
      { name: 'a', description: 'a', input_schema: {} as Anthropic.Tool.InputSchema },
      { name: 'b', description: 'b', input_schema: {} as Anthropic.Tool.InputSchema },
      { name: 'c', description: 'c', input_schema: {} as Anthropic.Tool.InputSchema },
    ];
    const out = markLastToolForCaching(tools, OPTIONS_1H);
    expect((out[0] as { cache_control?: unknown }).cache_control).toBeUndefined();
    expect((out[1] as { cache_control?: unknown }).cache_control).toBeUndefined();
    expect((out[2] as { cache_control?: unknown }).cache_control).toEqual(MARKER_1H);
  });

  it('is a no-op on empty tools', () => {
    expect(markLastToolForCaching([], OPTIONS_1H)).toEqual([]);
  });
});

describe('attachMessageCacheBreakpoints — raw block math (PRI-1805)', () => {
  it(`places anchor at least ${ANCHOR_OFFSET_RAW_BLOCKS} RAW blocks behind tail, counting thinking blocks`, () => {
    // Build a conversation with thinking blocks interleaved. The anchor must
    // count those toward the distance threshold even though it can't land
    // ON them.
    //
    // Layout (15 raw blocks total — anchor must be at raw distance >= 10):
    //   0  user  text  "go"
    //   1  asst  thinking "step 1"     ← non-cacheable
    //   2  asst  text  "I'll do it"
    //   3  asst  tool_use t1
    //   4  user  tool_result t1
    //   5  asst  thinking "step 2"     ← non-cacheable
    //   6  asst  text  "next"
    //   7  asst  tool_use t2
    //   8  user  tool_result t2
    //   9  asst  thinking "step 3"     ← non-cacheable
    //  10  asst  text  "another"
    //  11  asst  tool_use t3
    //  12  user  tool_result t3
    //  13  asst  text  "summary"
    //  14  user  text  "final"          ← TAIL
    //
    // Distance from tail (14) backward by 10 raw blocks → raw block 4.
    // Block 4 is a tool_result (cacheable). Anchor should land there.
    const messages: Anthropic.MessageParam[] = [
      user(text('go')),
      assistant(thinking('step 1'), text("I'll do it"), tool_use('t1')),
      user(tool_result('t1', 'r1')),
      assistant(thinking('step 2'), text('next'), tool_use('t2')),
      user(tool_result('t2', 'r2')),
      assistant(thinking('step 3'), text('another'), tool_use('t3')),
      user(tool_result('t3', 'r3')),
      assistant(text('summary')),
      user(text('final')),
    ];

    const out = attachMessageCacheBreakpoints(messages, OPTIONS_1H);
    const flat = flattenBlocks(out);

    // Tail at raw idx 14
    expect(flat[14].cache_control).toEqual(MARKER_1H);
    expect(flat[14].type).toBe('text');

    // Anchor at raw idx 4 (tool_result for t1) — exactly 10 raw blocks back.
    expect(flat[4].cache_control).toEqual(MARKER_1H);
    expect(flat[4].type).toBe('tool_result');

    // No other markers
    const markers = flat.filter((b) => b.cache_control !== undefined);
    expect(markers).toHaveLength(2);
  });

  it('never stamps cache_control on a thinking block, even when one would otherwise be at the anchor distance', () => {
    // Layout (12 raw blocks, anchor target at raw 1 which is thinking):
    //   0  user  text "go"
    //   1  asst  thinking "deep thought"  ← target distance — must SKIP
    //   2  asst  text "ok"
    //   ...8 more cacheable blocks to make the conversation long enough...
    //  11  user  text "final"
    const messages: Anthropic.MessageParam[] = [
      user(text('go')),
      assistant(thinking('deep'), text('ok'), tool_use('t1')),
      user(tool_result('t1', 'r1')),
      assistant(text('next'), tool_use('t2')),
      user(tool_result('t2', 'r2')),
      assistant(text('again'), tool_use('t3')),
      user(tool_result('t3', 'r3')),
      user(text('final')),
    ];

    const out = attachMessageCacheBreakpoints(messages, OPTIONS_1H);
    const flat = flattenBlocks(out);

    // Anywhere thinking appears, no cache_control
    for (const b of flat) {
      if (b.type === 'thinking' || b.type === 'redacted_thinking') {
        expect(b.cache_control).toBeUndefined();
      }
    }

    // Exactly 2 markers total (anchor + tail)
    const markers = flat.filter((b) => b.cache_control !== undefined);
    expect(markers).toHaveLength(2);
  });

  it('skips the anchor when the conversation is too short for the offset', () => {
    const messages = [user(text('hi')), assistant(text('hello'))];
    const out = attachMessageCacheBreakpoints(messages, OPTIONS_1H);
    const markers = flattenBlocks(out).filter((b) => b.cache_control !== undefined);
    expect(markers).toHaveLength(1);
  });

  it('returns messages unchanged when last message is empty', () => {
    const messages = [
      user(text('go')),
      assistant(text('ok')),
      // empty content array (e.g. assistant turn with only thinking, post-filter)
      { role: 'user' as const, content: [] },
    ];
    const out = attachMessageCacheBreakpoints(messages, OPTIONS_1H);
    expect(out).toBe(messages);
  });

  it('returns messages unchanged when last message contains only thinking blocks', () => {
    const messages = [user(text('go')), assistant(thinking('only this'))];
    const out = attachMessageCacheBreakpoints(messages, OPTIONS_1H);
    const markers = flattenBlocks(out).filter((b) => b.cache_control !== undefined);
    expect(markers).toHaveLength(0);
  });

  it('handles parallel tool calls (multi tool_use / multi tool_result in one turn)', () => {
    // Layout — assistant emits 3 parallel tool_use blocks, user responds
    // with 3 tool_result blocks. After 4 such turns plus a final user
    // message, we have plenty of raw blocks for an anchor.
    const messages: Anthropic.MessageParam[] = [];
    for (let i = 0; i < 4; i++) {
      messages.push(
        user(text(`q${i}`)),
        assistant(
          text(`ok ${i}`),
          tool_use(`t${i}a`, 'a'),
          tool_use(`t${i}b`, 'b'),
          tool_use(`t${i}c`, 'c')
        ),
        user(tool_result(`t${i}a`, 'ra'), tool_result(`t${i}b`, 'rb'), tool_result(`t${i}c`, 'rc'))
      );
    }
    messages.push(user(text('final')));

    const out = attachMessageCacheBreakpoints(messages, OPTIONS_1H);
    const flat = flattenBlocks(out);
    const markers = flat.filter((b) => b.cache_control !== undefined);
    expect(markers).toHaveLength(2);

    // Anchor must be ≥ANCHOR_OFFSET_RAW_BLOCKS raw blocks behind tail
    const tailIdx = markers[1].rawIdx;
    const anchorIdx = markers[0].rawIdx;
    expect(tailIdx - anchorIdx).toBeGreaterThanOrEqual(ANCHOR_OFFSET_RAW_BLOCKS);
  });
});

describe('attachMessageCacheBreakpoints — block-type whitelist (PRI-1806 #5)', () => {
  it('treats unknown block types as non-cacheable (whitelist, not blacklist)', () => {
    // Fabricate a block with an unknown type. Use `as unknown as` to bypass
    // the SDK's exhaustive union.
    const unknownBlock = {
      type: 'futuristic_block',
      payload: 'whatever',
    } as unknown as Anthropic.ContentBlockParam;
    const messages: Anthropic.MessageParam[] = [
      user(text('hi')),
      assistant(text('hello'), unknownBlock),
      user(text('final')),
    ];

    const out = attachMessageCacheBreakpoints(messages, OPTIONS_1H);
    const flat = flattenBlocks(out);

    // The unknown block must not carry cache_control.
    const unknownBlocks = flat.filter((b) => b.type === 'futuristic_block');
    for (const b of unknownBlocks) {
      expect(b.cache_control).toBeUndefined();
    }
  });
});

describe('bedrockCacheTtlFor (PRI-1803)', () => {
  it('returns 1h for Bedrock models on the supported allowlist', () => {
    expect(bedrockCacheTtlFor('anthropic.claude-opus-4-5-20251101-v1:0')).toBe('1h');
    expect(bedrockCacheTtlFor('anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('1h');
    expect(bedrockCacheTtlFor('anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('1h');
    // Inference-profile-style IDs are also matched by substring
    expect(bedrockCacheTtlFor('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('1h');
  });

  it('returns 5m for Bedrock models that only support short TTL', () => {
    expect(bedrockCacheTtlFor('anthropic.claude-opus-4-6-v1')).toBe('5m');
    expect(bedrockCacheTtlFor('anthropic.claude-sonnet-4-6')).toBe('5m');
    expect(bedrockCacheTtlFor('anthropic.claude-opus-4-20250514-v1:0')).toBe('5m');
    expect(bedrockCacheTtlFor('anthropic.claude-3-7-sonnet-20250219-v1:0')).toBe('5m');
    expect(bedrockCacheTtlFor('anthropic.claude-3-5-sonnet-20241022-v2:0')).toBe('5m');
  });
});

describe('budget enforcement (PRI-1806 #1)', () => {
  it('countCacheBreakpoints adds up markers across system/tools/messages', () => {
    const payload = {
      system: [
        { type: 'text' as const, text: 's', cache_control: MARKER_1H },
      ] as Anthropic.TextBlockParam[],
      tools: [{ cache_control: MARKER_1H }],
      messages: [
        user(text('a')),
        user({ ...text('b'), cache_control: MARKER_1H } as Anthropic.TextBlockParam),
      ],
    };
    expect(countCacheBreakpoints(payload)).toBe(3);
  });

  it('enforceBreakpointBudget strips oldest message-level markers first when over cap', () => {
    // 5 markers in messages — over the cap of 4. Strip the oldest one.
    const messages = [
      user({ ...text('first'), cache_control: MARKER_1H } as Anthropic.TextBlockParam),
      user({ ...text('second'), cache_control: MARKER_1H } as Anthropic.TextBlockParam),
      user({ ...text('third'), cache_control: MARKER_1H } as Anthropic.TextBlockParam),
      user({ ...text('fourth'), cache_control: MARKER_1H } as Anthropic.TextBlockParam),
      user({ ...text('fifth'), cache_control: MARKER_1H } as Anthropic.TextBlockParam),
    ];
    const result = enforceBreakpointBudget({ messages });

    const remainingMarkers = result.flatMap((m) =>
      Array.isArray(m.content)
        ? m.content.filter((b) => (b as { cache_control?: unknown }).cache_control)
        : []
    );
    expect(remainingMarkers).toHaveLength(MAX_CACHE_BREAKPOINTS);

    // First message lost its marker
    expect(
      Array.isArray(result[0].content) &&
        (result[0].content[0] as { cache_control?: unknown }).cache_control
    ).toBeFalsy();
    // Last message kept it
    expect(
      Array.isArray(result[4].content) &&
        (result[4].content[0] as { cache_control?: unknown }).cache_control
    ).toEqual(MARKER_1H);
  });

  it('is a no-op when within the budget', () => {
    const messages = [
      user({ ...text('only'), cache_control: MARKER_1H } as Anthropic.TextBlockParam),
    ];
    const result = enforceBreakpointBudget({ messages });
    expect(result).toBe(messages);
  });
});
