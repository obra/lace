// ABOUTME: Compaction toolkit — shared utilities for strategy implementations
// ABOUTME: Pure, self-contained (no rpc/utils dependency). Safe for cross-checkout import.

import { isEventOfType } from '@lace/agent/storage/event-types';
import type { TypedDurableEvent } from '@lace/agent/storage/event-types';
import type { ContentBlock, ThinkingBlock } from '@lace/agent/providers/base-provider';
import type { ToolCall as CoreToolCall, ToolResult as CoreToolResult } from '../tools/types';
import type { ToolResult as ProtocolToolResult } from '@lace/ent-protocol';
import { foldEvents } from '@lace/agent/message-building/fold-event';
import type { FoldEventInput } from '@lace/agent/message-building/fold-event';

// ---------------------------------------------------------------------------
// Tiny pure helpers copied from rpc/utils — toolkit must not import rpc/utils
// ---------------------------------------------------------------------------

/** Returns a non-empty trimmed string or null. */
export function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Convert a protocol ToolResult into a core ToolResult. */
export function coreToolResultFromProtocol(
  result: ProtocolToolResult,
  toolCallId: string
): CoreToolResult {
  const status: CoreToolResult['status'] =
    result.outcome === 'completed'
      ? 'completed'
      : result.outcome === 'denied'
        ? 'denied'
        : result.outcome === 'cancelled'
          ? 'aborted'
          : 'failed';

  const content: CoreToolResult['content'] = result.content.map((c) => {
    if (c.type === 'text') return { type: 'text', text: c.text };
    if (c.type === 'json') return { type: 'text', text: JSON.stringify(c.data, null, 2) };
    if (c.type === 'image') return { type: 'image', data: c.data };
    if (c.type === 'error') return { type: 'text', text: c.message };
    return { type: 'text', text: '' };
  });

  return {
    id: toolCallId,
    content,
    status,
    ...(result.meta ? { metadata: result.meta } : {}),
  };
}

// ---------------------------------------------------------------------------
// Replay-legality merge for preserved[] — message-builder replay does NOT
// repair same-role adjacency.
// ---------------------------------------------------------------------------

type Block = { type: string; [k: string]: unknown };

export interface PreservedEntry {
  role: string;
  content: string | Block[];
  toolCalls?: unknown[];
  toolResults?: unknown[];
}

function isEmpty(e: PreservedEntry): boolean {
  const hasTool = (e.toolCalls?.length ?? 0) > 0 || (e.toolResults?.length ?? 0) > 0;
  if (hasTool) return false;
  if (typeof e.content === 'string') return e.content.trim().length === 0;
  return e.content.length === 0;
}

function mergeContent(
  a: PreservedEntry['content'],
  b: PreservedEntry['content']
): PreservedEntry['content'] {
  if (typeof a === 'string' && typeof b === 'string')
    return a.trim() && b.trim() ? `${a}\n${b}` : a.trim() ? a : b;
  const arr = (c: PreservedEntry['content']): Block[] =>
    typeof c === 'string' ? (c.trim() ? [{ type: 'text', text: c }] : []) : c;
  return [...arr(a), ...arr(b)];
}

function mergeInto(a: PreservedEntry, b: PreservedEntry): PreservedEntry {
  return {
    role: a.role,
    content: mergeContent(a.content, b.content),
    toolCalls: [...(a.toolCalls ?? []), ...(b.toolCalls ?? [])],
    toolResults: [...(a.toolResults ?? []), ...(b.toolResults ?? [])],
  };
}

/**
 * Drop empties, merge consecutive same-role entries, ensure the first entry is
 * user-role. Returns [] when nothing remains (caller → noop). Idempotent.
 * Image/resource blocks are preserved verbatim (carried in the Block[] content).
 */
export function mergePreservedAdjacent(entries: PreservedEntry[]): PreservedEntry[] {
  const out: PreservedEntry[] = [];
  for (const raw of entries) {
    if (isEmpty(raw)) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === raw.role) out[out.length - 1] = mergeInto(prev, raw);
    else out.push({ ...raw });
  }
  // Ensure leading user-role: merge a leading assistant forward, else drop it.
  // Folding a leading assistant into the following user entry places the user's
  // content first and the assistant's content after it — a deliberate,
  // replay-legal reorder (chronology may invert in this rare edge case).
  while (out.length > 0 && out[0].role !== 'user') {
    if (out.length === 1) {
      out.shift();
      break;
    }
    const merged = mergeInto({ ...out[1], role: out[1].role }, out[0]);
    out.splice(0, 2, { ...merged, role: out[1].role });
  }
  return out;
}

// ---------------------------------------------------------------------------
// splitAtTailBoundary
// ---------------------------------------------------------------------------

/**
 * Split events into [earlier, tail] at the boundary that gives `tailTurns`
 * complete turns at the end. A turn is `prompt + turn_start ... turn_end`.
 *
 * The boundary semantics (always set at a prompt or turn_start) guarantee that
 * turns are never split, so tool_use/result pairs (both on the same turn) are
 * always kept together in the same slice. No snap-left is needed.
 */
export function splitAtTailBoundary(
  events: TypedDurableEvent[],
  tailTurns: number
): { earlier: TypedDurableEvent[]; tail: TypedDurableEvent[] } {
  if (tailTurns <= 0) {
    return { earlier: events.slice(), tail: [] };
  }

  // Walk backwards counting turn_end events; the boundary is just before the
  // prompt that opens the (tailTurns)-th turn from the end.
  const turnEndIdxs: number[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'turn_end') turnEndIdxs.push(i);
    if (turnEndIdxs.length >= tailTurns) break;
  }
  if (turnEndIdxs.length < tailTurns) {
    return { earlier: [], tail: events.slice() };
  }
  const earliestTailTurnEndIdx = turnEndIdxs[turnEndIdxs.length - 1];
  const targetTurnId = events[earliestTailTurnEndIdx].turnId;

  // No turnId means we can't reliably find the matching turn_start (e.g.
  // crash-recovery synthesized turn_end). Return all-as-tail rather than
  // risk mis-attributing events to the wrong slice.
  if (!targetTurnId) {
    return { earlier: [], tail: events.slice() };
  }

  let boundary = earliestTailTurnEndIdx;
  for (let i = earliestTailTurnEndIdx; i >= 0; i--) {
    if (events[i].type === 'turn_start' && events[i].turnId === targetTurnId) {
      if (i > 0 && events[i - 1].type === 'prompt') {
        boundary = i - 1;
      } else {
        boundary = i;
      }
      break;
    }
  }
  return { earlier: events.slice(0, boundary), tail: events.slice(boundary) };
}

// ---------------------------------------------------------------------------
// demuxByTrack — pure grouper with injected attribution function
// ---------------------------------------------------------------------------

/**
 * A pure grouper that buckets events by the string returned by `attributeFn`.
 * The caller supplies the attribution logic, making this domain-neutral.
 *
 * Used by track-based compaction with `kernelAttributor`; can be used by plugin
 * strategies with custom attributors (e.g. domain-specific attributors).
 */
export function demuxByTrack(
  events: TypedDurableEvent[],
  attributeFn: (event: TypedDurableEvent) => string
): Map<string, TypedDurableEvent[]> {
  const groups = new Map<string, TypedDurableEvent[]>();
  for (const e of events) {
    const track = attributeFn(e);
    const arr = groups.get(track) ?? [];
    arr.push(e);
    groups.set(track, arr);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// TrackBlock — the per-track rendered body shape
// ---------------------------------------------------------------------------

export type TrackBlock = {
  trackId: string;
  /** Markdown body for this track. */
  body: string;
  /** Rough token estimate (char/4). */
  estimatedTokens: number;
  /** ISO timestamp of the track's newest event (last-touched, not created). */
  lastActivityTs: string;
  /** eventSeq of the track's newest event. */
  lastSeq: number;
};

const estimate = (s: string) => Math.ceil(s.length / 4);

/** Job-list eviction tunables: keep within 2 days OR the 10 most-recent. */
const JOB_EVICT_HORIZON_MS = 2 * 24 * 60 * 60 * 1000;
const JOB_EVICT_FLOOR_N = 10;

/**
 * Last-touched activity of a track: the timestamp + eventSeq of its newest
 * event (highest eventSeq). Empty events → epoch / -1 (sorts oldest).
 */
function activityOf(events: TypedDurableEvent[]): { lastActivityTs: string; lastSeq: number } {
  let lastSeq = -1;
  let lastActivityTs = new Date(0).toISOString();
  for (const e of events) {
    if (e.eventSeq > lastSeq) {
      lastSeq = e.eventSeq;
      lastActivityTs = e.timestamp;
    }
  }
  return { lastActivityTs, lastSeq };
}

/**
 * Generic, domain-neutral recency keep-rule. Given `now`, an item is KEPT iff
 * `now - getTs(item) <= horizonMs` (age within horizon) OR it is among the
 * `floorN` items with the highest `getSeq` (recency floor). Returns the kept
 * items in original order. `floorN <= 0` disables the floor; if there are no
 * more than `floorN` items, all are kept.
 */
export function applyRecencyKeep<T>(
  items: T[],
  opts: {
    now: string;
    horizonMs: number;
    floorN: number;
    getTs: (item: T) => string;
    getSeq: (item: T) => number;
  }
): T[] {
  const { now, horizonMs, floorN, getTs, getSeq } = opts;
  if (items.length <= floorN) return items.slice();
  const nowMs = Date.parse(now);

  const topSeqs = new Set<number>();
  if (floorN > 0) {
    const seqs = items.map(getSeq).sort((a, b) => b - a);
    for (const s of seqs.slice(0, floorN)) topSeqs.add(s);
  }

  return items.filter(
    (item) => nowMs - Date.parse(getTs(item)) <= horizonMs || topSeqs.has(getSeq(item))
  );
}

// ---------------------------------------------------------------------------
// Generic salience helpers
// ---------------------------------------------------------------------------

export const UNTRACKED = 'untracked' as const;

function extractText(e: TypedDurableEvent): string {
  const data = e.data as { content?: unknown };
  const content = data.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (b): b is { type: 'text'; text: string } =>
          typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'text'
      )
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

/**
 * Drop a trailing high surrogate left dangling by a length-based slice. A
 * left-anchored `slice(0, n)` can cut a surrogate pair (e.g. an emoji) in half,
 * leaving a lone high surrogate; persisting that into compacted history makes
 * later Anthropic request bodies invalid JSON ("no low surrogate in string").
 * Only the trailing-high case is possible for a slice from index 0.
 */
export function stripTrailingLoneSurrogate(s: string): string {
  const last = s.charCodeAt(s.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? s.slice(0, -1) : s;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return stripTrailingLoneSurrogate(s.slice(0, max - 1)) + '…';
}

function statusGlyph(outcome: string): string {
  if (outcome === 'completed') return '✓ completed';
  if (outcome === 'failed') return '✗ failed';
  if (outcome === 'cancelled') return '⊘ cancelled';
  return outcome;
}

/**
 * Salience for job:<jobId> tracks: "- job:id description → outcome".
 * Returns a TrackBlock (never null).
 */
export function jobSalience(trackId: string, events: TypedDurableEvent[]): TrackBlock {
  let description = '(unknown)';
  let outcome: string | undefined;
  for (const e of events) {
    if (isEventOfType(e, 'job_started')) {
      description = e.data.description ?? e.data.command ?? '(no description)';
    } else if (isEventOfType(e, 'job_finished')) {
      outcome = e.data.outcome;
    }
  }
  const status = outcome ? statusGlyph(outcome) : '⏳ in-flight';
  const body = `- ${trackId} ${description} → ${status}`;
  return { trackId, body, estimatedTokens: estimate(body), ...activityOf(events) };
}

/**
 * Salience for untracked (and generic conversation) tracks:
 * User/Assistant/Note prose extraction.
 */
export function untrackedSalience(trackId: string, events: TypedDurableEvent[]): TrackBlock {
  const lines: string[] = [];
  for (const e of events) {
    if (isEventOfType(e, 'prompt')) {
      const t = extractText(e).trim();
      if (t) lines.push(`User: ${truncate(t, 500)}`);
    } else if (isEventOfType(e, 'message')) {
      const t = typeof e.data.content === 'string' ? e.data.content : extractText(e);
      if (t.trim()) lines.push(`Assistant: ${truncate(t.trim(), 500)}`);
    } else if (isEventOfType(e, 'context_injected')) {
      const t = extractText(e).trim();
      if (t) lines.push(`Note: ${truncate(t, 500)}`);
    }
  }
  const body = lines.length > 0 ? lines.join('\n') : '(empty)';
  return { trackId, body, estimatedTokens: estimate(body), ...activityOf(events) };
}

/**
 * Returns null for tracks that should be dropped entirely from the rendered
 * prefix: alarm:*, reminder:*, system:bootstrap.
 * Returns a TrackBlock for system:idle-errors (count-only summary).
 * Returns null for unrecognized system:* (caller decides fallback).
 */
export function systemSalience(trackId: string, events: TypedDurableEvent[]): TrackBlock | null {
  if (trackId.startsWith('alarm:') || trackId.startsWith('reminder:')) {
    return null;
  }
  if (trackId === 'system:bootstrap') {
    return null;
  }
  if (trackId === 'system:idle-errors') {
    const body = `${events.length} idle-error reports since last compaction.`;
    return { trackId, body, estimatedTokens: estimate(body), ...activityOf(events) };
  }
  // Unknown system: track — drop
  return null;
}

// ---------------------------------------------------------------------------
// Generic section renderer
// ---------------------------------------------------------------------------

export type SchedulerRollup = {
  alarmsPending: number;
  remindersPending: number;
};

export type GenericRenderInput = {
  blocks: TrackBlock[];
  scheduler: SchedulerRollup;
  /**
   * The compaction pass's "now". When set, the job list is aged against it
   * (age+floor eviction). Absent → no eviction (backward-safe).
   */
  referenceTimestamp?: string;
};

const HEADER = '[Earlier conversation, compacted by track]';

/**
 * Render job, scheduler, system/untracked, and "other" sections.
 *
 * Returns sections joined by newlines, starting with the header.
 * `extraSections` is an optional pre-rendered section string to inject first
 * (after the header, before job/scheduler/system/other). Used by plugin strategies
 * to inject domain-specific sections (e.g. a plugin's own rendered section).
 * When `extraSections` is provided, blocks whose trackId would be rendered by that
 * section are excluded from ## Other; when absent, all unrecognised blocks fall
 * through to ## Other.
 */
export function renderGenericSections(input: GenericRenderInput, extraSections?: string): string {
  let jobBlocks = input.blocks.filter((b) => b.trackId.startsWith('job:'));
  if (input.referenceTimestamp) {
    jobBlocks = applyRecencyKeep(jobBlocks, {
      now: input.referenceTimestamp,
      horizonMs: JOB_EVICT_HORIZON_MS,
      floorN: JOB_EVICT_FLOOR_N,
      getTs: (b) => b.lastActivityTs,
      getSeq: (b) => b.lastSeq,
    });
  }
  const systemBlocks = input.blocks.filter(
    (b) => b.trackId.startsWith('system:') || b.trackId === 'untracked'
  );
  const otherBlocks = input.blocks.filter(
    (b) =>
      !b.trackId.startsWith('job:') && !b.trackId.startsWith('system:') && b.trackId !== 'untracked'
  );

  const parts: string[] = [HEADER];

  if (extraSections) {
    parts.push(extraSections);
  }

  if (jobBlocks.length > 0) {
    parts.push('\n## Subagent jobs\n');
    parts.push(jobBlocks.map((b) => b.body).join('\n\n'));
  }

  const { alarmsPending, remindersPending } = input.scheduler;
  if (alarmsPending > 0 || remindersPending > 0) {
    parts.push('\n## Scheduler\n');
    parts.push(
      `${alarmsPending} alarm${alarmsPending === 1 ? '' : 's'} pending, ${remindersPending} reminder${remindersPending === 1 ? '' : 's'} pending. Use \`list_alarms\` / \`list_reminders\` for details.`
    );
  }

  if (systemBlocks.length > 0) {
    parts.push('\n## System events\n');
    parts.push(systemBlocks.map((b) => b.body).join('\n\n'));
  }

  if (otherBlocks.length > 0) {
    parts.push('\n## Other\n');
    parts.push(otherBlocks.map((b) => b.body).join('\n\n'));
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// buildPreservedTail and buildPreservedWithPrefix
// ---------------------------------------------------------------------------

type PreservedMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
  toolCalls?: CoreToolCall[];
  toolResults?: CoreToolResult[];
  thinkingBlocks?: ThinkingBlock[];
};

/**
 * Convert tail events into the PreservedMessage stream consumed by
 * message-builder.ts when replaying a context_compacted event.
 *
 * Delegates folding to the shared `foldEvents` reducer so the preserved tail has
 * the same canonical shape as the batch rebuild and the runner's live tail: a
 * turn's parallel tool calls fold into one assistant message carrying all
 * `tool_use` blocks followed by one user message carrying all `tool_result`
 * blocks (the Anthropic parallel-tool form). Content stays verbatim.
 *
 * The tail subset never contains `context_compacted`/`system_prompt_set`, and
 * `context_injected` is a plain user push (no merge) — exactly what the reducer
 * does. `PreservedMessage` is structurally identical to the reducer's
 * `ProviderMessage`, so the reducer's messages are returned directly.
 */
export function buildPreservedTail(events: TypedDurableEvent[]): PreservedMessage[] {
  const foldInputs: FoldEventInput[] = [];

  for (const e of events) {
    if (isEventOfType(e, 'prompt')) {
      foldInputs.push({ type: 'prompt', data: { content: e.data.content } });
      continue;
    }
    if (isEventOfType(e, 'context_injected')) {
      foldInputs.push({ type: 'context_injected', data: { content: e.data.content } });
      continue;
    }
    if (isEventOfType(e, 'message')) {
      foldInputs.push({
        type: 'message',
        data: { content: e.data.content, thinkingBlocks: e.data.thinkingBlocks },
      });
      continue;
    }
    if (isEventOfType(e, 'tool_use')) {
      foldInputs.push({
        type: 'tool_use',
        data: {
          toolCallId: e.data.toolCallId,
          name: e.data.name,
          input: e.data.input,
          result: e.data.result,
        },
      });
      continue;
    }
  }

  return foldEvents(foldInputs).messages;
}

/**
 * Prepend the compaction prefix to the preserved tail, merging into the first
 * entry when it is also user-role to prevent consecutive user messages.
 */
export function buildPreservedWithPrefix(
  prefix: string,
  tail: PreservedMessage[]
): PreservedMessage[] {
  if (tail.length === 0 || tail[0].role !== 'user') {
    // No adjacency problem — prefix stands alone.
    return [{ role: 'user', content: prefix }, ...tail];
  }

  // First tail entry is user-role: merge prefix into it.
  const first = tail[0];
  let mergedContent: string | ContentBlock[];
  if (typeof first.content === 'string') {
    mergedContent = prefix + '\n\n' + first.content;
  } else {
    // ContentBlock[] — build a merged block array preserving any existing blocks.
    const prefixBlock: ContentBlock = { type: 'text', text: prefix };
    mergedContent = [prefixBlock, ...first.content];
  }

  const mergedFirst: PreservedMessage = {
    role: 'user',
    content: mergedContent,
    ...(first.toolCalls ? { toolCalls: first.toolCalls } : {}),
    ...(first.toolResults ? { toolResults: first.toolResults } : {}),
  };

  return [mergedFirst, ...tail.slice(1)];
}
