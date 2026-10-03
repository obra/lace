// ABOUTME: Unit tests for the shared cache-control module — covers raw-block
// anchor math, block-type whitelist, and the 4-marker budget cap.

import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  ANCHOR_OFFSET_RAW_BLOCKS,
  MAX_CACHE_BREAKPOINTS,
  attachMessageCacheBreakpoints,
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

describe('attachMessageCacheBreakpoints — raw block math', () => {
  it(`places anchor at EXACTLY the raw distance ANCHOR_OFFSET_RAW_BLOCKS behind tail, not the cacheable-only distance`, () => {
    // Build a raw block layout by hand (alternating one cacheable block with
    // one non-cacheable thinking block) so we know, independently of
    // attachMessageCacheBreakpoints, exactly which raw index the anchor must
    // land on — and exactly which (wrong) index a cacheable-only distance
    // counter would land on instead. N is read from the constant (PRI-1821)
    // so the fixture and both expectations track it if it changes.
    //
    // Layout: raw 0 = cacheable "go"; then N groups of
    // (thinking, cacheable) pairs at raw 1..2N; then the tail at raw 2N+1.
    // Cacheable raw indices are {0, 2, 4, ..., 2N, 2N+1(tail)}.
    const N = ANCHOR_OFFSET_RAW_BLOCKS;
    const messages: Anthropic.MessageParam[] = [user(text('go'))];
    for (let i = 0; i < N; i++) {
      messages.push(assistant(thinking(`step ${i}`), text(`turn ${i}`)));
    }
    messages.push(user(text('final')));

    const tailRaw = 2 * N + 1;
    // Ground truth for the algorithm's contract (last cacheable raw index,
    // walking backward from the tail, whose RAW distance is >= N):
    // candidates are the even indices 0,2,...,2N. The largest one at
    // raw-distance >= N from tailRaw is 2N - N = N (raw N+1 is a thinking
    // block, so N is the closest usable one).
    const expectedAnchorRawDistanceIdx = 2 * N - N; // = N

    // What a mutation that counts CACHEABLE-ONLY distance instead of raw
    // distance would pick: in cacheable-only index space the tail is at
    // index N+1 (0..N are the paired cacheable blocks, N+1 is the tail), so
    // the last cacheable-only index at distance >= N is (N+1) - N = 1,
    // which is raw index 2*1 = 2.
    const expectedAnchorCacheableOnlyIdx = 2 * (N + 1 - N); // = 2

    // Sanity: the fixture only proves the raw-vs-cacheable distinction if
    // these two candidate answers actually differ.
    expect(expectedAnchorRawDistanceIdx).not.toBe(expectedAnchorCacheableOnlyIdx);

    const out = attachMessageCacheBreakpoints(messages, OPTIONS_1H);
    const flat = flattenBlocks(out);
    const tailIdx = flat.length - 1;
    expect(tailIdx).toBe(tailRaw);
    expect(flat[tailIdx].cache_control).toEqual(MARKER_1H);
    expect(flat[tailIdx].type).toBe('text');

    const markers = flat.filter((b) => b.cache_control !== undefined);
    expect(markers).toHaveLength(2);
    const anchorIdx = markers[0].rawIdx;

    // Exact placement — not just ">= N", which a cacheable-only counter
    // would also satisfy.
    expect(anchorIdx).toBe(expectedAnchorRawDistanceIdx);
    expect(anchorIdx).not.toBe(expectedAnchorCacheableOnlyIdx);
    expect(flat[anchorIdx].type).not.toBe('thinking');
  });

  it('never stamps cache_control on a thinking block, even when one sits exactly at the naive anchor target', () => {
    // Place the thinking block at EXACTLY raw distance ANCHOR_OFFSET_RAW_BLOCKS
    // behind the tail — the precise position a naive (type-blind) anchor
    // walk would land on — then fill the gap between it and the tail with
    // exactly N-1 cacheable blocks, so nothing else in that gap qualifies as
    // an anchor. A single earlier cacheable block (raw 0) is the only valid
    // fallback. This isolates the "skip past a disqualified candidate"
    // behavior instead of leaving it to chance where the padding lands
    // (PRI-1821 review finding 1).
    const N = ANCHOR_OFFSET_RAW_BLOCKS;
    const messages: Anthropic.MessageParam[] = [
      user(text('go')), // raw 0 — the only valid anchor candidate
      assistant(thinking('deep')), // raw 1 — exactly N behind the tail (raw N+1)
    ];
    for (let i = 0; i < N - 1; i++) {
      // raw 2..N — cacheable filler, all too close to the tail (< N away)
      messages.push(i % 2 === 0 ? assistant(text(`turn ${i}`)) : user(text(`turn ${i}`)));
    }
    messages.push(user(text('final'))); // raw N+1 — tail

    const tailRaw = N + 1;

    const out = attachMessageCacheBreakpoints(messages, OPTIONS_1H);
    const flat = flattenBlocks(out);
    const tailIdx = flat.length - 1;
    expect(tailIdx).toBe(tailRaw);

    // Anywhere thinking appears, no cache_control
    for (const b of flat) {
      if (b.type === 'thinking' || b.type === 'redacted_thinking') {
        expect(b.cache_control).toBeUndefined();
      }
    }

    // Exactly 2 markers total (anchor + tail)
    const markers = flat.filter((b) => b.cache_control !== undefined);
    expect(markers).toHaveLength(2);

    // The anchor must have skipped past the disqualified thinking block at
    // raw 1 and landed on the nearest cacheable block before it — raw 0.
    const anchorIdx = markers[0].rawIdx;
    expect(anchorIdx).toBe(0);
    expect(flat[anchorIdx].type).not.toBe('thinking');
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

  it('anchor breakpoint stays reachable across turn-to-turn growth, for every Δ in the anchor+tail union (PRI-1821)', () => {
    // Regression for PRI-1821, generalized per review finding 4: sampling a
    // single Δ (the original test only checked Δ=40) cannot catch an
    // OVER-WIDENED N that opens a hole just above the tail path's own
    // 20-block reach, at Δ ∈ (20, N) — e.g. N=22 leaves Δ=21 uncovered even
    // though every other cache-control test still passes. Loop the full Δ
    // range instead of sampling one point.
    //
    // The two paths that keep a turn's write reachable from the next turn's
    // breakpoints (derivation in the cache-control.ts module comment):
    //   • tail path:   Δ ≤ 20
    //   • anchor path: N ≤ Δ ≤ N + 20
    // Their union is gap-free only for N ≤ 21.
    //
    // We loop Δ up to max(N + 20, PRI_1819_INCIDENT_DELTA) rather than just
    // N + 20, so that reverting N back below what PRI-1819 needs still
    // fails THIS test at the historical incident's own magnitude, not just
    // whatever range happens to fall out of the current N.
    const N = ANCHOR_OFFSET_RAW_BLOCKS;
    // The turn-to-turn growth PRI-1819's post-deploy data measured a real
    // cache bust at was 41 blocks; 40 is the largest Δ still meant to be
    // covered (N=20's anchor-path edge, Δ ≤ N+20).
    const PRI_1819_INCIDENT_DELTA = 40;

    // Each turn below is a single cacheable text block, so raw-flat index
    // equals message index — that makes the arithmetic exact and legible.
    // Turn 1 is sized off N (not hardcoded) with margin so it always gets
    // its own anchor regardless of N's current value.
    const turn1Length = N + 5;
    const turn1Messages: Anthropic.MessageParam[] = [];
    for (let i = 0; i < turn1Length; i++) {
      turn1Messages.push(i % 2 === 0 ? user(text(`u${i}`)) : assistant(text(`a${i}`)));
    }
    const turn1Out = attachMessageCacheBreakpoints(turn1Messages, OPTIONS_1H);
    const turn1Markers = flattenBlocks(turn1Out).filter((b) => b.cache_control !== undefined);
    expect(turn1Markers).toHaveLength(2);
    const tail1Idx = turn1Markers[turn1Markers.length - 1].rawIdx;

    const maxDelta = Math.max(N + 20, PRI_1819_INCIDENT_DELTA);
    for (let delta = 0; delta <= maxDelta; delta++) {
      const turn2Messages = [...turn1Messages];
      for (let i = 0; i < delta; i++) {
        const idx = turn1Length + i;
        turn2Messages.push(idx % 2 === 0 ? user(text(`u${idx}`)) : assistant(text(`a${idx}`)));
      }
      const turn2Out = attachMessageCacheBreakpoints(turn2Messages, OPTIONS_1H);
      const turn2Markers = flattenBlocks(turn2Out).filter((b) => b.cache_control !== undefined);
      expect(turn2Markers).toHaveLength(2);
      const tail2Idx = turn2Markers[turn2Markers.length - 1].rawIdx;
      const anchor2Idx = turn2Markers[0].rawIdx;

      // Reachable via the tail path (new tail's own lookback reaches the
      // prior tail directly) OR via the anchor path (new anchor's lookback
      // reaches the prior tail). If neither holds, the prior turn's cache
      // write is unreachable from EITHER of this turn's breakpoints.
      const reachableViaTail = tail2Idx - tail1Idx <= 20;
      const reachableViaAnchor = anchor2Idx - tail1Idx >= 0 && anchor2Idx - tail1Idx <= 20;
      expect(reachableViaTail || reachableViaAnchor).toBe(true);
    }
  });
});

describe('attachMessageCacheBreakpoints — block-type whitelist', () => {
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

  it('treats SDK-cacheable block types beyond the original 5 as cacheable', () => {
    // SDK 0.60 confirms cache_control is accepted on server_tool_use,
    // web_search_tool_result, and search_result. The previous whitelist
    // excluded them, leaving cache reach on the floor for hosted-tool workloads.
    //
    // This test proves the new types are treated as cacheable by placing
    // web_search_tool_result as the ONLY block in the last message. Without
    // it being whitelisted, attachMessageCacheBreakpoints refuses to place
    // any markers (the tail guard fires: last cacheable block is not in the
    // last message). With it whitelisted, both tail and anchor are placed.
    //
    //
    // Before whitelist expansion:
    //   - web_search_tool_result is non-cacheable
    //   - last cacheable block is server_tool_use, one message back
    //   - tail guard: tail's message isn't the last message → return unchanged
    //   - result: 0 markers
    //
    // After whitelist expansion:
    //   - web_search_tool_result IS cacheable → it becomes the tail
    //   - server_tool_use IS cacheable → appears in cacheablePositions
    //   - anchor at raw distance >= ANCHOR_OFFSET_RAW_BLOCKS from tail
    //   - result: 2 markers
    //
    // Filler count is sized off ANCHOR_OFFSET_RAW_BLOCKS (not hardcoded —
    // PRI-1821) so there's always room for a real anchor ahead of the
    // server_tool_use / web_search_tool_result pair, whatever the offset is.
    const serverToolUseBlock = {
      type: 'server_tool_use',
      id: 'st1',
      name: 'web_search',
      input: {},
    } as unknown as Anthropic.ContentBlockParam;

    const webSearchResultBlock = {
      type: 'web_search_tool_result',
      tool_use_id: 'st1',
      content: [],
    } as unknown as Anthropic.ContentBlockParam;

    const messages: Anthropic.MessageParam[] = [user(text('q1'))];
    const fillerBlocks = ANCHOR_OFFSET_RAW_BLOCKS + 4;
    for (let i = 0; i < fillerBlocks; i++) {
      messages.push(assistant(text(`filler ${i}`)));
    }
    messages.push(assistant(serverToolUseBlock));
    messages.push(user(webSearchResultBlock));

    const out = attachMessageCacheBreakpoints(messages, OPTIONS_1H);
    const flat = flattenBlocks(out);
    const markers = flat.filter(
      (b) => (b as { cache_control?: unknown }).cache_control !== undefined
    );

    // Both tail (web_search_tool_result) and anchor must be placed.
    expect(markers).toHaveLength(2);

    // Tail must be the web_search_tool_result block.
    const tailMarker = markers[markers.length - 1];
    expect(tailMarker.type).toBe('web_search_tool_result');

    // Anchor at raw distance >= ANCHOR_OFFSET_RAW_BLOCKS from tail.
    const anchorMarker = markers[0];
    expect(tailMarker.rawIdx - anchorMarker.rawIdx).toBeGreaterThanOrEqual(
      ANCHOR_OFFSET_RAW_BLOCKS
    );
  });
});

describe('budget enforcement', () => {
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

  it('enforceBreakpointBudget strips NEWEST message-level markers first when over cap (anchor preservation)', () => {
    // 5 markers in messages — over the cap of 4. Strip the NEWEST first
    // so the stable anchor (oldest) survives. This is the breakpoint added
    // specifically to defeat Anthropic's 20-block lookback window;
    // evicting it first would defeat the whole point.
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

    // Last (newest) message lost its marker
    expect(
      Array.isArray(result[4].content) &&
        (result[4].content[0] as { cache_control?: unknown }).cache_control
    ).toBeFalsy();
    // First (oldest = anchor position) kept it
    expect(
      Array.isArray(result[0].content) &&
        (result[0].content[0] as { cache_control?: unknown }).cache_control
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
