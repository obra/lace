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
  };
}

function renderKindAndContent(
  type: TypedDurableEvent['type'],
  data: TypedDurableEvent['data']
): { kind: RecallKind; content: string } | null {
  switch (type) {
    case 'prompt':
      return { kind: 'user_message', content: renderPromptContent(data as PromptEventData) };
    case 'message':
      return { kind: 'assistant_text', content: renderMessageContent(data as MessageEventData) };
    case 'tool_use':
      return { kind: 'tool_call', content: renderToolUseContent(data as ToolUseEventData) };
    case 'context_injected':
      return {
        kind: 'notification',
        content: renderInjectedContent(data as ContextInjectedEventData),
      };
    case 'context_compacted':
      return {
        kind: 'system',
        content: renderCompactedContent(data as ContextCompactedEventData),
      };
    default:
      return null;
  }
}

function renderPromptContent(data: PromptEventData): string {
  return renderContentBlocks(data.content);
}

function renderMessageContent(data: MessageEventData): string {
  if (typeof data.content === 'string') return data.content;
  return renderContentBlocks(data.content);
}

function renderInjectedContent(data: ContextInjectedEventData): string {
  return renderContentBlocks(data.content);
}

function renderContentBlocks(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'text') return b.text;
      // image
      return `[image: ${b.source.media_type}]`;
    })
    .join('\n');
}

function renderToolUseContent(data: ToolUseEventData): string {
  const lines = [`tool=${data.name}`, `input=${JSON.stringify(data.input)}`];
  if (data.result !== undefined) {
    lines.push(`result=${renderToolResultText(data.result)}`);
  }
  return lines.join('\n');
}

function renderToolResultText(result: ToolResult): string {
  return result.content
    .map((block) => (block.type === 'text' ? (block.text ?? '') : ''))
    .filter((s) => s.length > 0)
    .join('\n');
}

function renderCompactedContent(data: ContextCompactedEventData): string {
  if (typeof data.summary === 'string' && data.summary.length > 0) return data.summary;
  return `[compaction: ${data.strategy}]`;
}
