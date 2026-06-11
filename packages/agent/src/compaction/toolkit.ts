// ABOUTME: Compaction toolkit — shared utilities for strategy implementations
// ABOUTME: Pure, self-contained (no rpc/utils dependency). Safe for cross-checkout import.

import { isEventOfType } from '@lace/agent/storage/event-types';
import type { TypedDurableEvent } from '@lace/agent/storage/event-types';
import type { ContentBlock } from '@lace/agent/providers/base-provider';
import type { ToolCall as CoreToolCall, ToolResult as CoreToolResult } from '../tools/types';
import type { ToolResult as ProtocolToolResult } from '@lace/ent-protocol';

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
};

const estimate = (s: string) => Math.ceil(s.length / 4);

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
  return { trackId, body, estimatedTokens: estimate(body) };
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
  return { trackId, body, estimatedTokens: estimate(body) };
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
    return { trackId, body, estimatedTokens: estimate(body) };
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
  const jobBlocks = input.blocks.filter((b) => b.trackId.startsWith('job:'));
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
};

/**
 * Convert tail events into the PreservedMessage stream consumed by
 * message-builder.ts when replaying a context_compacted event.
 *
 * Mirrors the logic in message-builder.ts:buildProviderMessagesFromDurableEvents:
 * - `prompt`   → user entry
 * - `message`  → assistant entry
 * - `tool_use` → assistant entry (with toolCalls) + optional user entry (with toolResults)
 *
 * Consecutive tool_use events for the same turn are coalesced: tool calls are
 * appended to the previous assistant entry; tool results are appended to the
 * previous user entry when it already holds results.
 */
export function buildPreservedTail(events: TypedDurableEvent[]): PreservedMessage[] {
  const result: PreservedMessage[] = [];

  for (const e of events) {
    if (isEventOfType(e, 'prompt')) {
      // Pass through the original content (string or ContentBlock[]) so images
      // in the tail are not discarded — extractText would drop image blocks.
      result.push({ role: 'user', content: e.data.content });
      continue;
    }

    if (isEventOfType(e, 'context_injected')) {
      // Mirror message-builder.ts: injected context becomes a user-role message.
      // Pass through the original content to preserve any image blocks.
      result.push({ role: 'user', content: e.data.content });
      continue;
    }

    if (isEventOfType(e, 'message')) {
      // Pass through the original content to preserve any image blocks.
      result.push({ role: 'assistant', content: e.data.content ?? '' });
      continue;
    }

    if (isEventOfType(e, 'tool_use')) {
      const toolCallId = toNonEmptyString(e.data.toolCallId);
      const name = toNonEmptyString(e.data.name);
      if (!toolCallId || !name) continue;

      const toolCall: CoreToolCall = {
        id: toolCallId,
        name,
        arguments:
          typeof e.data.input === 'object' && e.data.input
            ? (e.data.input as Record<string, unknown>)
            : {},
      };

      // Coalesce into previous assistant entry if it exists, otherwise push new.
      const last = result.length > 0 ? result[result.length - 1] : undefined;
      if (last && last.role === 'assistant') {
        last.toolCalls = [...(last.toolCalls ?? []), toolCall];
      } else {
        result.push({ role: 'assistant', content: '', toolCalls: [toolCall] });
      }

      if (e.data.result) {
        const coreResult = coreToolResultFromProtocol(e.data.result, toolCallId);
        // Coalesce into previous user entry if it already carries tool results.
        const prev = result.length > 0 ? result[result.length - 1] : undefined;
        const canAppend =
          prev &&
          prev.role === 'user' &&
          Array.isArray(prev.toolResults) &&
          prev.toolResults.length > 0;
        if (canAppend && prev) {
          prev.toolResults = [...(prev.toolResults ?? []), coreResult];
        } else {
          result.push({ role: 'user', content: '', toolResults: [coreResult] });
        }
      }
      continue;
    }
  }

  return result;
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
