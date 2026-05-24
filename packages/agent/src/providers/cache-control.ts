// ABOUTME: Shared prompt-caching helpers for Anthropic-shaped providers
// ABOUTME: (Anthropic direct + Bedrock). Places cache_control breakpoints on
// system, last tool, and a rolling-tail + stable-anchor pair on messages.

import type Anthropic from '@anthropic-ai/sdk';

// Anthropic enforces a hard limit of 4 explicit cache_control breakpoints per
// request. Per the cookbook: "automatic caching consumes one of these
// available slots". We are defensive and stamp at most 4 (one slot used by
// us per system/last-tool/anchor/tail), reserving none for auto.
export const MAX_CACHE_BREAKPOINTS = 4;

// Anthropic's cache lookup window is ~20 raw content blocks per breakpoint.
// PRI-1805: the offset is in **raw** blocks, not cacheable-only — thinking
// blocks count toward the lookback budget even though we never stamp them.
// Placing the anchor 10 raw blocks behind the tail keeps both markers
// reachable from the next request's breakpoints for turn growth Δ ≤ 10
// blocks via the tail path AND extends reachability to Δ ≤ 30 via the
// anchor path. See PRI-1805 description for the derivation.
export const ANCHOR_OFFSET_RAW_BLOCKS = 10;

// Whitelist of block types that accept `cache_control` AND are sensible
// breakpoint targets. PRI-1806 #5: only stamp types confirmed by the SDK
// type definitions to carry cache_control; refuse unknown types rather than
// silently stamping them.
// PRI-1806 #5 follow-up: SDK 0.60 confirms server_tool_use,
// web_search_tool_result, and search_result accept cache_control too.
const CACHEABLE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'text',
  'image',
  'document',
  'tool_use',
  'tool_result',
  'server_tool_use',
  'web_search_tool_result',
  'search_result',
]);

export type CacheTtl = '5m' | '1h';

export interface CacheControlOptions {
  /** TTL for all breakpoints emitted by this provider. */
  ttl: CacheTtl;
}

// Bedrock model IDs that the AWS docs confirm support 1h TTL (as of
// 2026-05-23: docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html).
// Anything not in this set falls back to the default 5m. List uses
// substring matching against the full Bedrock model ID — covers the
// `anthropic.claude-…-v1:0` and inference-profile-id variants.
const BEDROCK_1H_TTL_MODEL_SUBSTRINGS: readonly string[] = [
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
];

/**
 * Pick the longest cache TTL the given Bedrock model accepts. Bedrock 1h
 * TTL is GA only on a specific allowlist (Opus/Sonnet/Haiku 4.5); other
 * models silently fall back to the default 5m if 1h is sent — and at 2×
 * write cost that fallback is a real waste. Gate per-model.
 */
export function bedrockCacheTtlFor(modelId: string): CacheTtl {
  return BEDROCK_1H_TTL_MODEL_SUBSTRINGS.some((s) => modelId.includes(s)) ? '1h' : '5m';
}

function makeMarker(ttl: CacheTtl): Anthropic.CacheControlEphemeral {
  return { type: 'ephemeral', ttl };
}

// ──────────────────────────────────────────────────────────────────────────
// Public: system + tools breakpoints
// ──────────────────────────────────────────────────────────────────────────

/**
 * Convert a raw system-prompt string into the array form Anthropic requires
 * for prompt caching, stamping a single cache_control marker on it.
 */
export function buildSystemWithCaching(
  systemPrompt: string,
  options: CacheControlOptions
): Anthropic.TextBlockParam[] {
  return [
    {
      type: 'text',
      text: systemPrompt,
      cache_control: makeMarker(options.ttl),
    },
  ];
}

/**
 * Return the tools array with cache_control stamped on the LAST tool. The
 * last-tool marker caches the entire tools-array prefix.
 */
export function markLastToolForCaching<
  T extends { cache_control?: Anthropic.CacheControlEphemeral | null },
>(tools: T[], options: CacheControlOptions): T[] {
  if (tools.length === 0) return tools;
  return tools.map((tool, index) =>
    index === tools.length - 1 ? { ...tool, cache_control: makeMarker(options.ttl) } : tool
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Public: message breakpoints (rolling tail + stable anchor)
// ──────────────────────────────────────────────────────────────────────────

// Position of a single content block within `messages`. `blockIdx === null`
// means the message's content is a plain string and will be lifted to a
// single text block when we stamp it.
interface BlockPosition {
  msgIdx: number;
  blockIdx: number | null;
  rawFlatIdx: number; // position in the wire-order block stream (counts ALL types)
  cacheable: boolean;
}

function isCacheable(block: Anthropic.ContentBlockParam): boolean {
  return CACHEABLE_BLOCK_TYPES.has(block.type);
}

function collectAllBlockPositions(messages: Anthropic.MessageParam[]): BlockPosition[] {
  const out: BlockPosition[] = [];
  let flat = 0;
  for (let m = 0; m < messages.length; m++) {
    const content = messages[m].content;
    if (typeof content === 'string') {
      if (content.length > 0) {
        out.push({ msgIdx: m, blockIdx: null, rawFlatIdx: flat++, cacheable: true });
      }
    } else {
      for (let b = 0; b < content.length; b++) {
        out.push({
          msgIdx: m,
          blockIdx: b,
          rawFlatIdx: flat++,
          cacheable: isCacheable(content[b]),
        });
      }
    }
  }
  return out;
}

function isMessageEmpty(msg: Anthropic.MessageParam): boolean {
  return typeof msg.content === 'string' ? msg.content.length === 0 : msg.content.length === 0;
}

/**
 * Attach up to two 1h cache_control breakpoints to message content:
 *   • rolling tail — last cacheable block of the last (non-empty) message
 *   • stable anchor — at least ANCHOR_OFFSET_RAW_BLOCKS *raw* blocks behind
 *     the tail (counting thinking blocks too, since the lookback window
 *     counts them too)
 *
 * Refuses to attach anything when the last message has empty content or
 * contains only non-cacheable blocks (e.g. only thinking). Anchor is
 * skipped on conversations too short to warrant one.
 *
 * Returns a new array; inputs are not mutated.
 */
export function attachMessageCacheBreakpoints(
  messages: Anthropic.MessageParam[],
  options: CacheControlOptions
): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  if (isMessageEmpty(messages[messages.length - 1])) return messages;

  const allPositions = collectAllBlockPositions(messages);
  const cacheablePositions = allPositions.filter((p) => p.cacheable);
  if (cacheablePositions.length === 0) return messages;

  // Tail must live in the last message — otherwise refuse rather than
  // anchoring on history (e.g. last message contains only thinking blocks).
  const tail = cacheablePositions[cacheablePositions.length - 1];
  if (tail.msgIdx !== messages.length - 1) return messages;

  // Anchor = the most recent cacheable block whose raw-flat distance from
  // the tail is at least ANCHOR_OFFSET_RAW_BLOCKS. Walking backward, take
  // the FIRST candidate that meets the threshold so the anchor is as close
  // to the tail as the offset allows — that keeps the anchor reachable
  // from the next request's tail breakpoint (see derivation in cache-control.ts
  // module comment).
  let anchor: BlockPosition | null = null;
  for (let i = cacheablePositions.length - 2; i >= 0; i--) {
    const candidate = cacheablePositions[i];
    if (tail.rawFlatIdx - candidate.rawFlatIdx >= ANCHOR_OFFSET_RAW_BLOCKS) {
      anchor = candidate;
      break;
    }
  }

  const targets: BlockPosition[] = anchor ? [anchor, tail] : [tail];
  return applyBreakpoints(messages, targets, options);
}

function applyBreakpoints(
  messages: Anthropic.MessageParam[],
  positions: BlockPosition[],
  options: CacheControlOptions
): Anthropic.MessageParam[] {
  // Deduplicate by msgIdx so we clone each touched message exactly once.
  const dirtyMsgIdxs = [...new Set(positions.map((p) => p.msgIdx))];

  const result = messages.slice();
  for (const idx of dirtyMsgIdxs) {
    const msg = result[idx];
    if (typeof msg.content === 'string') {
      result[idx] = { ...msg, content: [{ type: 'text', text: msg.content }] };
    } else {
      result[idx] = { ...msg, content: msg.content.slice() };
    }
  }

  // Single pass: mutate each touched message's (already cloned) content
  // array in place. After the clone above every dirty message has array
  // content, so the cast is safe.
  for (const pos of positions) {
    const blocks = result[pos.msgIdx].content as Anthropic.ContentBlockParam[];
    const targetIdx = pos.blockIdx ?? 0;
    blocks[targetIdx] = {
      ...blocks[targetIdx],
      cache_control: makeMarker(options.ttl),
    } as Anthropic.ContentBlockParam;
  }

  return result;
}

// ──────────────────────────────────────────────────────────────────────────
// Defensive budget check
// ──────────────────────────────────────────────────────────────────────────

/**
 * Count cache_control markers across the full request shape. Used to fail
 * loudly if we'd send more than Anthropic's 4-marker hard cap.
 */
export function countCacheBreakpoints(payload: {
  system?: Anthropic.TextBlockParam[] | string;
  tools?: Array<{ cache_control?: Anthropic.CacheControlEphemeral | null }>;
  messages: Anthropic.MessageParam[];
}): number {
  let count = 0;
  if (Array.isArray(payload.system)) {
    for (const block of payload.system) {
      if (block.cache_control) count++;
    }
  }
  if (payload.tools) {
    for (const tool of payload.tools) {
      if (tool.cache_control) count++;
    }
  }
  for (const msg of payload.messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if ((block as { cache_control?: unknown }).cache_control) count++;
      }
    }
  }
  return count;
}

/**
 * If a payload would exceed MAX_CACHE_BREAKPOINTS, drop message-level
 * breakpoints from the NEWEST first so the stable anchor (oldest) survives.
 * Returns a possibly-modified messages array.
 */
export function enforceBreakpointBudget(payload: {
  system?: Anthropic.TextBlockParam[] | string;
  tools?: Array<{ cache_control?: Anthropic.CacheControlEphemeral | null }>;
  messages: Anthropic.MessageParam[];
}): Anthropic.MessageParam[] {
  const total = countCacheBreakpoints(payload);
  if (total <= MAX_CACHE_BREAKPOINTS) return payload.messages;

  // PRI-1806 #1 (revised after adversarial review): strip NEWEST message
  // markers first so the stable anchor (oldest) survives. The anchor is
  // expensive to position (PRI-1805 raw-block math) and exists specifically
  // to defeat Anthropic's 20-block lookback. The rolling tail is
  // regenerated on every turn and cheap to lose.
  let toDrop = total - MAX_CACHE_BREAKPOINTS;

  // Walk messages newest-to-oldest, dropping markers as we go.
  const reversed = [...payload.messages].reverse();
  const stripped = reversed.map((msg) => {
    if (toDrop === 0) return msg;
    if (!Array.isArray(msg.content)) return msg;
    let touched = false;
    // Within a message, also walk blocks newest-to-oldest (right-to-left).
    const blocks = [...msg.content].reverse().map((block) => {
      if (toDrop === 0) return block;
      if ((block as { cache_control?: unknown }).cache_control) {
        toDrop--;
        touched = true;
        const { cache_control: _drop, ...rest } = block as unknown as Record<string, unknown>;
        return rest as unknown as Anthropic.ContentBlockParam;
      }
      return block;
    });
    return touched ? { ...msg, content: blocks.reverse() } : msg;
  });
  const result = stripped.reverse();

  // If toDrop is still > 0 after the message-stripping pass, system/tools
  // markers alone are pushing the total over cap. We can't safely strip
  // those here (that would mask a programmer error upstream). Warn loudly
  // so the regression surfaces in production logs before Anthropic 400s the
  // request.
  if (toDrop > 0) {
    console.warn(
      `[cache-control] enforceBreakpointBudget: cache_control budget exceeded: ${total} markers but only ${MAX_CACHE_BREAKPOINTS} allowed. ` +
        `Could not reduce — system/tools markers consumed too many slots. Request will likely 400.`
    );
  }

  return result;
}
