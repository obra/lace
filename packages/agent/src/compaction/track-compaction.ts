// ABOUTME: Track-based compaction strategy — demux + salience + render
// ABOUTME: Replaces summarize-strategy.ts; reuses context_compacted event type

import { isEventDataOfType } from '@lace/agent/storage/event-types';
import type { TypedDurableEvent, ContextCompactedEventData } from '@lace/agent/storage/event-types';
import { renderCompactionPrefix } from './track-render';
import type { CompactionContext } from './types';

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
    if (isEventDataOfType(e.data, 'prompt')) {
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

    if (isEventDataOfType(e.data, 'context_injected')) {
      // Mid-turn injects use their OWN track regardless of enclosing turn.
      push(e.data.track ?? UNTRACKED, e);
      continue;
    }

    if (isEventDataOfType(e.data, 'prompt')) {
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

function jobSalience(trackId: string, events: TypedDurableEvent[]): TrackBlock {
  let description = '(unknown)';
  let outcome: string | undefined;
  for (const e of events) {
    if (isEventDataOfType(e.data, 'job_started')) {
      description = e.data.description ?? e.data.command ?? '(no description)';
    } else if (isEventDataOfType(e.data, 'job_finished')) {
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
    if (isEventDataOfType(e.data, 'prompt')) {
      const text = extractText(e);
      // Pull just the <current> portion if the new envelope is in use; else
      // include the whole text (untouched).
      const current = extractCurrentMessages(text);
      if (current) inbound.push(...current);
      else if (text.trim()) inbound.push(text.trim().slice(0, 500));
    } else if (isEventDataOfType(e.data, 'tool_use')) {
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
    if (isEventDataOfType(e.data, 'prompt')) {
      const t = extractText(e).trim();
      if (t) lines.push(`User: ${truncate(t, 500)}`);
    } else if (isEventDataOfType(e.data, 'message')) {
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
 * Snaps leftward if the boundary would split an assistant tool_use from its
 * matching tool_result.
 */
export function splitAtTailBoundary(
  events: TypedDurableEvent[],
  tailTurns: number
): { earlier: TypedDurableEvent[]; tail: TypedDurableEvent[] } {
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
  boundary = snapLeftIfOrphanedTool(events, boundary);
  return { earlier: events.slice(0, boundary), tail: events.slice(boundary) };
}

/**
 * If the given boundary would leave a tool_use in the "earlier" slice whose
 * matching tool_result lives in the "tail" slice, snap the boundary leftward
 * until no such orphan exists. This preserves the tool_use/tool_result pairing
 * invariant required for valid Anthropic conversation turns.
 */
function snapLeftIfOrphanedTool(events: TypedDurableEvent[], boundary: number): number {
  while (boundary > 0) {
    const oldToolCallIds = new Set<string>();
    for (let i = 0; i < boundary; i++) {
      const e = events[i];
      if (isEventDataOfType(e.data, 'tool_use')) {
        oldToolCallIds.add(e.data.toolCallId);
      }
    }
    let hasOrphan = false;
    for (let i = boundary; i < events.length && !hasOrphan; i++) {
      const e = events[i];
      if (!isEventDataOfType(e.data, 'message')) continue;
      const content = e.data.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (
          typeof block === 'object' &&
          block !== null &&
          (block as { type?: unknown }).type === 'tool_result'
        ) {
          const tcid = (block as { toolCallId?: unknown }).toolCallId;
          if (typeof tcid === 'string' && oldToolCallIds.has(tcid)) {
            hasOrphan = true;
            break;
          }
        }
      }
    }
    if (!hasOrphan) return boundary;
    boundary -= 1;
  }
  return boundary;
}

/**
 * Track-based compaction orchestrator. Pure: returns the event the caller
 * should write, without writing it.
 */
export async function compact(
  events: TypedDurableEvent[],
  _ctx: CompactionContext
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
      if (block) blocks.push(block);
    }
    prefixContent = renderCompactionPrefix({
      blocks,
      scheduler: { alarmsPending: 0, remindersPending: 0 },
    });
  }

  const preservedTail = tail
    .filter((e) => e.type === 'message' || e.type === 'prompt')
    .map((e) => preservedMessageFromEvent(e));

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

function preservedMessageFromEvent(e: TypedDurableEvent): {
  role: 'user' | 'assistant';
  content: string;
} {
  const text = extractText(e);
  return { role: e.type === 'prompt' ? 'user' : 'assistant', content: text };
}
