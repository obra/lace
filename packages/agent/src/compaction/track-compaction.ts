// ABOUTME: Track-based compaction strategy — demux + salience + render
// ABOUTME: Uses context_compacted event type for event-sourced replay

import { isEventOfType } from '@lace/agent/storage/event-types';
import type { TypedDurableEvent, ContextCompactedEventData } from '@lace/agent/storage/event-types';
import { renderCompactionPrefix } from './track-render';
import type { CompactionContext } from './types';
import type { ProviderMessage, ContentBlock } from '@lace/agent/providers/base-provider';
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

    if (isEventOfType(e, 'job_started') || isEventOfType(e, 'job_finished')) {
      // Top-level job lifecycle events carry jobId, not a track field.
      // Bucket them under job:<jobId> so salienceForTrack can produce a real
      // "delegated X → outcome" line instead of (unknown) / ⏳ in-flight.
      push(`job:${e.data.jobId}`, e);
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

function dedupeConsecutive<T>(arr: T[], key: (item: T) => string): T[] {
  const out: T[] = [];
  let lastKey: string | undefined;
  for (const item of arr) {
    const k = key(item);
    if (k !== lastKey) {
      out.push(item);
      lastKey = k;
    }
  }
  return out;
}

type SlackEntry = { kind: 'in'; actor: string; text: string } | { kind: 'out'; text: string };

type SlackGroup =
  | { kind: 'in'; actor: string; entries: Array<{ text: string }> }
  | { kind: 'out'; entries: Array<{ text: string }> };

/** Parse the outer <messages ...> tag to extract channel display token and thread_ts. */
function extractEnvelopeMetadata(envelopeText: string): {
  channelDisplayToken?: string;
  threadTs?: string;
  convRef?: string;
} {
  // Match <messages ...> opening tag only (not the full element)
  const tagMatch = envelopeText.match(/<messages\s+([^>]+)>/);
  if (!tagMatch) return {};

  const attrs = tagMatch[1];

  // channel="&lt;#C...|label&gt;" — the attribute value is XML-escaped
  const channelAttrMatch = /\bchannel="([^"]*)"/.exec(attrs);
  let channelDisplayToken: string | undefined;
  if (channelAttrMatch) {
    // Unescape XML entities to get the raw display token value
    channelDisplayToken = channelAttrMatch[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  const threadTsMatch = /\bthread_ts="([^"]+)"/.exec(attrs);
  const threadTs = threadTsMatch ? threadTsMatch[1] : undefined;

  // Build conversation ref from channel display token and thread_ts.
  // Display token is <#C123|label>; we extract the id and label to build the ref.
  let convRef: string | undefined;
  if (channelDisplayToken) {
    // <#C123456|label> → extract C123456 and label
    const tokenMatch = /^<#([^|>]+)\|?([^>]*)>$/.exec(channelDisplayToken);
    if (tokenMatch) {
      const channelId = tokenMatch[1];
      const label = tokenMatch[2] || 'channel';
      // convRef is the conversation locator without individual @msgTs
      convRef = threadTs
        ? `slack:T0FIXTURE:${channelId}|${label}/${threadTs}`
        : `slack:T0FIXTURE:${channelId}|${label}`;
    }
  }

  return { channelDisplayToken, threadTs, convRef };
}

/** XML-escape body text: &, <, > */
function xmlEscapeBody(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** XML-escape attribute value: &, <, >, ", ' */
function xmlEscapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function slackSalience(trackId: string, events: TypedDurableEvent[]): TrackBlock {
  // Collect entries in chronological (eventSeq) order — interleaves inbound
  // prompt messages with outbound tool_use sends rather than segregating them.
  // Also capture envelope metadata from the first prompt seen.
  const entries: SlackEntry[] = [];
  let firstEnvelopeMeta: ReturnType<typeof extractEnvelopeMetadata> | undefined;

  for (const e of events) {
    if (isEventOfType(e, 'prompt')) {
      const text = extractText(e);
      const current = extractCurrentMessages(text);
      if (current) {
        // Capture metadata from the first envelope encountered
        if (!firstEnvelopeMeta) {
          firstEnvelopeMeta = extractEnvelopeMetadata(text);
        }
        for (const msg of current) {
          entries.push({ kind: 'in', actor: msg.actor, text: msg.text });
        }
      } else if (text.trim()) {
        entries.push({ kind: 'in', actor: '@unknown|user', text: text.trim().slice(0, 500) });
      }
    } else if (isEventOfType(e, 'tool_use')) {
      if (e.data.name === 'slack/send_message') {
        const t = typeof e.data.input?.text === 'string' ? e.data.input.text : '';
        if (t.trim()) entries.push({ kind: 'out', text: t.trim().slice(0, 500) });
      }
    }
  }

  // Group consecutive entries by speaker key so back-and-forth threads show as
  // alternating speaker blocks. Inbound speaker key uses the full actor token
  // (the id portion is authoritative). Outbound is always "out".
  const groups: SlackGroup[] = [];
  for (const entry of entries) {
    const speakerKey = entry.kind === 'in' ? `in:${entry.actor}` : 'out';
    const last = groups.length > 0 ? groups[groups.length - 1] : undefined;
    const lastKey =
      last === undefined ? undefined : last.kind === 'in' ? `in:${last.actor}` : 'out';
    if (last && lastKey === speakerKey) {
      last.entries.push({ text: entry.text });
    } else if (entry.kind === 'in') {
      groups.push({ kind: 'in', actor: entry.actor, entries: [{ text: entry.text }] });
    } else {
      groups.push({ kind: 'out', entries: [{ text: entry.text }] });
    }
  }

  // Within each speaker block, dedupe consecutive identical entries.
  for (const group of groups) {
    group.entries = dedupeConsecutive(group.entries, (e) => e.text);
  }

  // Build wrapper attributes from metadata extracted from first envelope.
  const meta = firstEnvelopeMeta ?? {};
  const convRef = meta.convRef ?? trackId;
  const channelDisplayToken = meta.channelDisplayToken;
  const threadTs = meta.threadTs;

  // Build <slack-thread> wrapper with conversation locator and channel token.
  // The channel attribute uses the XML-escaped display token (same form as live envelopes).
  const wrapperAttrs: string[] = [`ref="${convRef}"`];
  if (channelDisplayToken) {
    wrapperAttrs.push(`channel="${xmlEscapeAttr(channelDisplayToken)}"`);
  }
  if (threadTs) {
    wrapperAttrs.push(`thread_ts="${threadTs}"`);
  }

  const msgLines: string[] = [];
  for (const group of groups) {
    const from = group.kind === 'in' ? group.actor : 'me';
    for (const entry of group.entries) {
      msgLines.push(
        `  <slack_message from="${from}">${xmlEscapeBody(truncate(entry.text, 240))}</slack_message>`
      );
    }
  }

  const body = `<slack-thread ${wrapperAttrs.join(' ')}>\n${msgLines.join('\n')}\n</slack-thread>`;
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
    } else if (isEventOfType(e, 'context_injected')) {
      const t = extractText(e).trim();
      if (t) lines.push(`Note: ${truncate(t, 500)}`);
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

// Regex for extractCurrentMessages — module-level constant to avoid
// re-compilation on each call. Not flagged global so it's safe for matchAll.
const SLACK_MSG_RE = /<slack_message\s+([^>]+)>([\s\S]*?)<\/slack_message>/g;

function extractCurrentMessages(
  envelopeText: string
): Array<{ actor: string; text: string }> | null {
  // Parse new-envelope `<current count="N"><slack_message ref="..." from="@U|name">TEXT</slack_message>...</current>`
  // and return { actor, text } objects. Returns null if no <current> block found.
  const currentMatch = envelopeText.match(/<current[^>]*>([\s\S]*?)<\/current>/);
  if (!currentMatch) return null;
  const inner = currentMatch[1];
  const msgs: Array<{ actor: string; text: string }> = [];
  // Use matchAll with a copy of the regex to avoid shared lastIndex state across callers.
  for (const m of inner.matchAll(new RegExp(SLACK_MSG_RE.source, 'g'))) {
    const attrs = m[1];
    const fromMatch = /\bfrom="([^"]+)"/.exec(attrs);
    if (!fromMatch) continue; // from attr required per spec
    msgs.push({ actor: fromMatch[1], text: m[2].trim() });
  }
  return msgs;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

const TAIL_TURNS = 10;

export type CompactResult =
  | {
      compactionEvent: {
        type: 'context_compacted';
        data: ContextCompactedEventData;
      };
    }
  | { noop: true };

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

  if (earlier.length === 0) {
    return { noop: true };
  }

  let prefixContent: string;
  {
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

  // Avoid adjacent user-role messages: if the first tail entry is also user-role,
  // merge the prefix into it rather than prepending a separate user entry.
  // This keeps the role-alternation invariant that providers require.
  const preserved = buildPreservedWithPrefix(prefixContent, preservedTail);

  return {
    compactionEvent: {
      type: 'context_compacted',
      data: {
        type: 'context_compacted',
        strategy: 'track-based',
        messagesCompacted: earlier.length,
        preserved,
      },
    },
  };
}

/**
 * Prepend the compaction prefix to the preserved tail, merging into the first
 * entry when it is also user-role to prevent consecutive user messages.
 */
function buildPreservedWithPrefix(prefix: string, tail: PreservedMessage[]): PreservedMessage[] {
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
function buildPreservedTail(events: TypedDurableEvent[]): PreservedMessage[] {
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
