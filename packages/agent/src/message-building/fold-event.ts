// ABOUTME: The single pure reducer that folds durable events into the canonical
// ProviderMessage[] shape. One assistant carries all of a turn's tool_use blocks;
// one user carries all of that turn's tool_result blocks (the Anthropic parallel-
// tool form). This is the one place event->message coalescing happens; the batch
// rebuild, the compaction-tail build, and the runner's live tail all share it, so
// the shape sent on turn N equals the shape rebuilt on turn N+1.

import type { ContentBlock, ProviderMessage, ThinkingBlock } from '../providers/base-provider';
import type { ToolResult as ProtocolToolResult } from '@lace/ent-protocol';
import type { ToolCall as CoreToolCall, ToolResult as CoreToolResult } from '../tools/types';
import { coreToolResultFromProtocol, toNonEmptyString } from '../rpc/utils';

export type FoldEventInput =
  | { type: 'prompt'; data: { content: unknown } }
  | { type: 'context_injected'; data: { content: unknown } }
  | { type: 'message'; data: { content?: unknown; thinkingBlocks?: unknown } }
  | {
      type: 'tool_use';
      data: { toolCallId?: unknown; name?: unknown; input?: unknown; result?: unknown };
    };

export type FoldState = {
  messages: ProviderMessage[];
  // Open tool batch for the current turn: indices into messages, or null between turns.
  batch: { assistantIdx: number; userIdx: number | null } | null;
};

export function initialFoldState(): FoldState {
  return { messages: [], batch: null };
}

// Content helper: the reducer keeps content VERBATIM (string or ContentBlock[]).
// Callers that need text-flattening (e.g. the context_injected merge in
// message-builder) do it BEFORE calling foldEvent; the reducer itself never drops
// image blocks.
function asContent(raw: unknown): string | ContentBlock[] {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw as ContentBlock[];
  return '';
}

export function foldEvent(state: FoldState, event: FoldEventInput): FoldState {
  const messages = state.messages.slice();

  if (event.type === 'tool_use') {
    const id = toNonEmptyString(event.data.toolCallId);
    const name = toNonEmptyString(event.data.name);
    if (!id || !name) return { messages, batch: state.batch };
    const call: CoreToolCall = {
      id,
      name,
      arguments:
        typeof event.data.input === 'object' && event.data.input
          ? (event.data.input as Record<string, unknown>)
          : {},
    };

    // Find/establish the batch assistant: reuse the open batch's assistant; else
    // adopt a trailing assistant; else push a new empty assistant.
    let batch = state.batch;
    if (!batch) {
      const lastIdx = messages.length - 1;
      if (lastIdx >= 0 && messages[lastIdx]!.role === 'assistant') {
        batch = { assistantIdx: lastIdx, userIdx: null };
      } else {
        messages.push({ role: 'assistant', content: '', toolCalls: [] });
        batch = { assistantIdx: messages.length - 1, userIdx: null };
      }
    }
    const a = messages[batch.assistantIdx]!;
    messages[batch.assistantIdx] = { ...a, toolCalls: [...(a.toolCalls ?? []), call] };

    if (event.data.result) {
      const result: CoreToolResult = coreToolResultFromProtocol(
        event.data.result as ProtocolToolResult,
        id
      );
      if (batch.userIdx === null) {
        messages.push({ role: 'user', content: '', toolResults: [result] });
        batch = { assistantIdx: batch.assistantIdx, userIdx: messages.length - 1 };
      } else {
        const u = messages[batch.userIdx]!;
        messages[batch.userIdx] = { ...u, toolResults: [...(u.toolResults ?? []), result] };
      }
    }
    return { messages, batch };
  }

  // Any non-tool_use event closes the batch.
  if (event.type === 'message') {
    const content = asContent(event.data.content);
    const thinkingBlocks =
      Array.isArray(event.data.thinkingBlocks) && event.data.thinkingBlocks.length > 0
        ? (event.data.thinkingBlocks as ThinkingBlock[])
        : undefined;
    messages.push({ role: 'assistant', content, ...(thinkingBlocks ? { thinkingBlocks } : {}) });
    return { messages, batch: null };
  }

  if (event.type === 'prompt' || event.type === 'context_injected') {
    messages.push({ role: 'user', content: asContent(event.data.content) });
    return { messages, batch: null };
  }

  return { messages, batch: state.batch };
}

export function foldEvents(events: FoldEventInput[]): FoldState {
  let s = initialFoldState();
  for (const e of events) s = foldEvent(s, e);
  return s;
}
