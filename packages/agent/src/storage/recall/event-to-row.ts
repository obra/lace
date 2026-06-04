// ABOUTME: Pure translation from a DurableEvent to a RecallRow for the FTS index
// ABOUTME: Returns null for event kinds that are not user-facing memory (turns, jobs, etc.)

import type { ToolResult } from '@lace/ent-protocol';
import type {
  ContentBlock,
  ContextCompactedEventData,
  ContextInjectedEventData,
  MessageEventData,
  PromptEventData,
  ToolUseEventData,
  TypedDurableEvent,
} from '../event-types';

export type RecallKind =
  | 'user_message'
  | 'assistant_text'
  | 'tool_call'
  | 'notification'
  | 'system';

export type RecallRow = {
  event_id: string;
  session_id: string;
  ts: string;
  persona: string | null;
  kind: RecallKind;
  content: string;
  /**
   * Conversation-track key (e.g. `slack:T123:C456/1678`), or null when not
   * deterministically attributable from the event alone.
   *
   * v1 scope: populated from `event.data.track` on `prompt` and
   * `context_injected` events (producers stamp these). `tool_use` and
   * `message` events carry no `track` field, so they index as null.
   * Notably, outbound `slack/send_message` sends are NOT track-attributed
   * here: deriving their track requires `teamId` (session install-scope)
   * which the stateless per-event indexer does not have access to without
   * threading new state through the index path. v1 limitation: track-filtered
   * recall covers inbound stamped prompts/injects but not the agent's outbound
   * prose or non-stamped tool calls. The pointer still recovers the inbound
   * thread, which is sufficient for re-reading the conversation.
   */
  track: string | null;
};

export type RowContext = {
  sessionId: string;
  persona: string | null;
};

export function eventToRow(event: TypedDurableEvent, ctx: RowContext): RecallRow | null {
  // The discriminator on disk is `event.type`. `event.data` is a payload object
  // whose `type` field is NOT serialized by `appendDurableEvent` — callers
  // construct it as a plain `Record<string, unknown>`. Read the outer type and
  // narrow the payload to the matching shape for renderers.
  const kindAndContent = renderKindAndContent(event.type, event.data);
  if (!kindAndContent) return null;
  return {
    event_id: `${ctx.sessionId}:${event.eventSeq}`,
    session_id: ctx.sessionId,
    ts: event.timestamp,
    persona: ctx.persona,
    kind: kindAndContent.kind,
    content: kindAndContent.content,
    track: extractTrack(event.type, event.data),
  };
}

/**
 * Extract the conversation-track key from an event, or return null.
 *
 * v1 scope: only `prompt` and `context_injected` events carry a `track` field
 * stamped by their producers. All other event types return null.
 *
 * Notably absent: `tool_use` (no track field on ToolUseEventData) and
 * outbound `slack/send_message` sends (their track would require `teamId`
 * from session install-scope, which the stateless indexer does not have).
 * See RecallRow.track for the full v1 scope documentation.
 */
function extractTrack(
  type: TypedDurableEvent['type'],
  data: TypedDurableEvent['data']
): string | null {
  if (type === 'prompt' || type === 'context_injected') {
    const track = (data as { track?: unknown }).track;
    if (typeof track === 'string' && track.length > 0) return track;
  }
  return null;
}

function renderKindAndContent(
  type: TypedDurableEvent['type'],
  data: TypedDurableEvent['data']
): { kind: RecallKind; content: string } | null {
  // Every renderer below tolerates a missing/malformed `data` payload — a
  // production JSONL transcript can contain events written by older callers
  // or by partial writes. Returning null here causes the row to be skipped
  // (no FTS index entry) without disturbing the surrounding write/backfill
  // transaction. Throwing was the original failure mode of C2/I3 (one bad
  // event poisons backfill or crashes recall.read).
  switch (type) {
    case 'prompt': {
      const content = renderPromptContent(data as PromptEventData);
      return content === null ? null : { kind: 'user_message', content };
    }
    case 'message': {
      const content = renderMessageContent(data as MessageEventData);
      return content === null ? null : { kind: 'assistant_text', content };
    }
    case 'tool_use': {
      const content = renderToolUseContent(data as ToolUseEventData);
      return content === null ? null : { kind: 'tool_call', content };
    }
    case 'context_injected': {
      const content = renderInjectedContent(data as ContextInjectedEventData);
      return content === null ? null : { kind: 'notification', content };
    }
    case 'context_compacted':
      return {
        kind: 'system',
        content: renderCompactedContent(data as ContextCompactedEventData),
      };
    default:
      return null;
  }
}

function renderPromptContent(data: PromptEventData): string | null {
  return renderContentBlocks(data?.content);
}

function renderMessageContent(data: MessageEventData): string | null {
  if (typeof data?.content === 'string') return data.content;
  return renderContentBlocks(data?.content);
}

function renderInjectedContent(data: ContextInjectedEventData): string | null {
  return renderContentBlocks(data?.content);
}

function renderContentBlocks(blocks: ContentBlock[] | undefined | null): string | null {
  if (!Array.isArray(blocks)) return null;
  const parts = blocks
    .map((b) => {
      if (!b || typeof b !== 'object') return '';
      if (b.type === 'text') return typeof b.text === 'string' ? b.text : '';
      if (b.type === 'image') {
        const mediaType = b.source?.media_type ?? 'unknown';
        return `[image: ${mediaType}]`;
      }
      return '';
    })
    .filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  return parts.join('\n');
}

function renderToolUseContent(data: ToolUseEventData): string | null {
  if (!data || typeof data.name !== 'string') return null;
  const lines = [`tool=${data.name}`, `input=${JSON.stringify(data.input ?? null)}`];
  if (data.result !== undefined) {
    const resultText = renderToolResultText(data.result);
    if (resultText !== null) lines.push(`result=${resultText}`);
  }
  return lines.join('\n');
}

function renderToolResultText(result: ToolResult | undefined): string | null {
  if (!result || !Array.isArray(result.content)) return null;
  return result.content
    .map((block) => (block && block.type === 'text' ? (block.text ?? '') : ''))
    .filter((s) => s.length > 0)
    .join('\n');
}

function renderCompactedContent(data: ContextCompactedEventData): string {
  if (data && typeof data.summary === 'string' && data.summary.length > 0) return data.summary;
  const strategy = data?.strategy ?? 'unknown';
  return `[compaction: ${strategy}]`;
}
