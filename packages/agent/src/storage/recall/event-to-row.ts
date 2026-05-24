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
  const kindAndContent = renderKindAndContent(event.data);
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
  data: TypedDurableEvent['data']
): { kind: RecallKind; content: string } | null {
  switch (data.type) {
    case 'prompt':
      return { kind: 'user_message', content: renderPromptContent(data) };
    case 'message':
      return { kind: 'assistant_text', content: renderMessageContent(data) };
    case 'tool_use':
      return { kind: 'tool_call', content: renderToolUseContent(data) };
    case 'context_injected':
      return { kind: 'notification', content: renderInjectedContent(data) };
    case 'context_compacted':
      return { kind: 'system', content: renderCompactedContent(data) };
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
