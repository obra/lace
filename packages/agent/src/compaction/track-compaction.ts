// ABOUTME: Track-based compaction strategy — demux + salience + render
// ABOUTME: Uses context_compacted event type for event-sourced replay

import { isEventOfType } from '@lace/agent/storage/event-types';
import type { TypedDurableEvent, ContextCompactedEventData } from '@lace/agent/storage/event-types';
import { renderCompactionPrefix } from './track-render';
import type { CompactionContext } from './types';
import type { ProviderMessage } from '@lace/agent/providers/base-provider';
import { coreToolResultFromProtocol, toNonEmptyString } from '../rpc/utils';
import type { ToolCall as CoreToolCall, ToolResult as CoreToolResult } from '../tools/types';

export const UNTRACKED = 'untracked' as const;

/**
 * Walk events and map each `turn_start.turnId` to the track of the
 * immediately preceding `prompt` event. Used to attribute in-turn events
 * (tool_use, message, turn_end) to a track.
 */
export function buildTurnToTrackMap(events: TypedDurableEvent[]): Map<string, string> {
  const map = new Map<string, string>();
  let pendingPromptTrack: string | undefined;
  for (const e of events) {
    if (isEventOfType(e, 'prompt')) {
      pendingPromptTrack = e.data.track ?? UNTRACKED;
      continue;
    }
    if (e.type === 'turn_start' && e.turnId) {
      map.set(e.turnId, pendingPromptTrack ?? UNTRACKED);
      pendingPromptTrack = undefined;
    }
  }
  return map;
}

/**
 * Group events by track for per-track salience extraction.
 *
 * - Filters out `context_compacted` events (we always rebuild from canonical).
 * - In-turn events inherit their turn's track from `turnToTrack`.
 * - Mid-turn `context_injected` events (no turnId or with their own track)
 *   are emitted under their own `data.track`.
 * - Top-level prompts/injects without a containing turn use their own track.
 * - Events without a track field fall into `'untracked'`.
 */
export function groupEarlierEventsByTrack(
  events: TypedDurableEvent[],
  turnToTrack: Map<string, string>
): Map<string, TypedDurableEvent[]> {
  const groups = new Map<string, TypedDurableEvent[]>();
  const push = (track: string, e: TypedDurableEvent) => {
    const arr = groups.get(track) ?? [];
    arr.push(e);
    groups.set(track, arr);
  };

  for (const e of events) {
    if (e.type === 'context_compacted') continue;

    if (isEventOfType(e, 'context_injected')) {
      // Mid-turn injects use their OWN track regardless of enclosing turn.
      push(e.data.track ?? UNTRACKED, e);
      continue;
    }

    if (isEventOfType(e, 'prompt')) {
      push(e.data.track ?? UNTRACKED, e);
      continue;
    }

    if (e.turnId && turnToTrack.has(e.turnId)) {
      push(turnToTrack.get(e.turnId)!, e);
      continue;
    }

    // Top-level event without a turnId attribution — bucket as untracked.
    push(UNTRACKED, e);
  }

  return groups;
}

export type TrackBlock = {
  trackId: string;
  /** Markdown body for this track. */
  body: string;
  /** Rough token estimate (char/4). */
  estimatedTokens: number;
};

const estimate = (s: string) => Math.ceil(s.length / 4);

/**
 * Per-track salience extraction. Returns null for tracks that should be
 * dropped entirely from the rendered prefix (alarm/reminder/bootstrap).
 */
export function salienceForTrack(trackId: string, events: TypedDurableEvent[]): TrackBlock | null {
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
  if (trackId.startsWith('job:')) {
    return jobSalience(trackId, events);
  }
  if (trackId.startsWith('slack:')) {
    return slackSalience(trackId, events);
  }
  return untrackedSalience(trackId, events);
}

const SOFT_TOKEN_CAP_PER_TRACK = 5_000;

/**
 * If a track's deterministic block exceeds the token cap and a provider/agent
 * is available, ask the LLM to summarize. Falls back to the original block on
 * any error or empty response.
 */
async function maybeShrinkBlock(block: TrackBlock, ctx: CompactionContext): Promise<TrackBlock> {
  if (block.estimatedTokens <= SOFT_TOKEN_CAP_PER_TRACK) return block;
  if (!ctx.provider && !ctx.agent) return block;
  // If we have a provider but no modelId, we cannot select a model — skip LLM fallback.
  if (ctx.provider && !ctx.modelId) return block;
  const trackKind = block.trackId.split(':')[0];
  const prompt =
    `Summarize the following ${trackKind} track conversation concisely. ` +
    `Preserve who said what, key decisions, and open questions. ` +
    `Output at most 800 tokens.\n\n${block.body}`;
  let summary = '';
  try {
    if (ctx.agent) {
      summary = await ctx.agent.generateSummary(prompt);
    } else if (ctx.provider) {
      const messages: ProviderMessage[] = [{ role: 'user', content: prompt }];
      const resp = await ctx.provider.createResponse(messages, [], ctx.modelId!);
      summary = resp.content;
    }
  } catch {
    return block; // on error, keep deterministic block
  }
  if (!summary.trim()) return block;
  const body = `### ${block.trackId}\n${summary}`;
  return { trackId: block.trackId, body, estimatedTokens: estimate(body) };
}

function jobSalience(trackId: string, events: TypedDurableEvent[]): TrackBlock {
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

function statusGlyph(outcome: string): string {
  if (outcome === 'completed') return '✓ completed';
  if (outcome === 'failed') return '✗ failed';
  if (outcome === 'cancelled') return '⊘ cancelled';
  return outcome;
}

function slackSalience(trackId: string, events: TypedDurableEvent[]): TrackBlock {
  const inbound: string[] = [];
  const outbound: string[] = [];
  for (const e of events) {
    if (isEventOfType(e, 'prompt')) {
      const text = extractText(e);
      // Pull just the <current> portion if the new envelope is in use; else
      // include the whole text (untouched).
      const current = extractCurrentMessages(text);
      if (current) inbound.push(...current);
      else if (text.trim()) inbound.push(text.trim().slice(0, 500));
    } else if (isEventOfType(e, 'tool_use')) {
      if (e.data.name === 'slack/send_message') {
        const t = typeof e.data.input?.text === 'string' ? e.data.input.text : '';
        if (t.trim()) outbound.push(t.trim().slice(0, 500));
      }
    }
  }
  const lines: string[] = [`### ${trackId}`];
  for (const t of inbound) lines.push(`- They said: ${truncate(t, 240)}`);
  for (const t of outbound) lines.push(`- You replied: ${truncate(t, 240)}`);
  const body = lines.join('\n');
  return { trackId, body, estimatedTokens: estimate(body) };
}

function untrackedSalience(trackId: string, events: TypedDurableEvent[]): TrackBlock {
  const lines: string[] = [];
  for (const e of events) {
    if (isEventOfType(e, 'prompt')) {
      const t = extractText(e).trim();
      if (t) lines.push(`User: ${truncate(t, 500)}`);
    } else if (isEventOfType(e, 'message')) {
      const t = typeof e.data.content === 'string' ? e.data.content : extractText(e);
      if (t.trim()) lines.push(`Assistant: ${truncate(t.trim(), 500)}`);
    }
  }
  const body = lines.length > 0 ? lines.join('\n') : '(empty)';
  return { trackId, body, estimatedTokens: estimate(body) };
}

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

function extractCurrentMessages(envelopeText: string): string[] | null {
  // Parse new-envelope `<current count="N"><slack_message ...>TEXT</slack_message>...</current>`
  // and return the inner texts. Returns null if no <current> block found.
  const currentMatch = envelopeText.match(/<current[^>]*>([\s\S]*?)<\/current>/);
  if (!currentMatch) return null;
  const inner = currentMatch[1];
  const msgs: string[] = [];
  const msgRegex = /<slack_message[^>]*>([\s\S]*?)<\/slack_message>/g;
  let m: RegExpExecArray | null;
  while ((m = msgRegex.exec(inner)) !== null) {
    msgs.push(m[1].trim());
  }
  return msgs;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

const TAIL_TURNS = 10;

export interface CompactResult {
  compactionEvent: {
    type: 'context_compacted';
    data: ContextCompactedEventData;
  };
}

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

/**
 * Track-based compaction orchestrator. Pure: returns the event the caller
 * should write, without writing it.
 */
export async function compact(
  events: TypedDurableEvent[],
  ctx: CompactionContext
): Promise<CompactResult> {
  const { earlier, tail } = splitAtTailBoundary(events, TAIL_TURNS);

  let prefixContent: string;
  if (earlier.length === 0) {
    prefixContent = '[Earlier conversation, compacted by track]\n(no earlier content)';
  } else {
    const turnToTrack = buildTurnToTrackMap(events);
    const groups = groupEarlierEventsByTrack(earlier, turnToTrack);
    const blocks: TrackBlock[] = [];
    for (const [trackId, trackEvents] of groups) {
      const block = salienceForTrack(trackId, trackEvents);
      if (!block) continue;
      blocks.push(await maybeShrinkBlock(block, ctx));
    }
    prefixContent = renderCompactionPrefix({
      blocks,
      scheduler: { alarmsPending: 0, remindersPending: 0 },
    });
  }

  const preservedTail = buildPreservedTail(tail);

  return {
    compactionEvent: {
      type: 'context_compacted',
      data: {
        type: 'context_compacted',
        strategy: 'track-based',
        messagesCompacted: earlier.length,
        preserved: [{ role: 'user', content: prefixContent }, ...preservedTail],
      },
    },
  };
}

type PreservedMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
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
function buildPreservedTail(events: TypedDurableEvent[]): PreservedMessage[] {
  const result: PreservedMessage[] = [];

  for (const e of events) {
    if (isEventOfType(e, 'prompt')) {
      result.push({ role: 'user', content: extractText(e) });
      continue;
    }

    if (isEventOfType(e, 'context_injected')) {
      // Mirror message-builder.ts: injected context becomes a user-role message
      // with the extracted text content. Dropping these would silently remove
      // recent injected context (Slack threads, fired alarms, etc.) from the tail.
      result.push({ role: 'user', content: extractText(e) });
      continue;
    }

    if (isEventOfType(e, 'message')) {
      result.push({ role: 'assistant', content: extractText(e) });
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
