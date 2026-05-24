// ABOUTME: Message building utilities for converting durable events to provider messages

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolResult } from '@lace/ent-protocol';
import type { ContentBlock, ProviderMessage } from '../providers/base-provider';
import { toNonEmptyString, coreToolResultFromProtocol } from '../rpc/utils';
import { appendOrMergeUser } from './append-or-merge';
import type { ToolCall as CoreToolCall, ToolResult as CoreToolResult } from '../tools/types';
import { estimateTokens } from '@lace/agent/utils/token-estimation';
import { logger } from '@lace/agent/utils/logger';

// Typed shapes for parsing event data
type TextBlock = { type: 'text'; text: string };
type ContentBlockShape = { type?: unknown; text?: unknown };
type ContextInjectedData = { content?: unknown[] };
type ContextCompactedData = { summary?: string; preserved?: unknown[] };
type SystemPromptSetData = { text?: unknown };
type MessageData = { content?: string | unknown[] };
type ToolUseData = { toolCallId?: unknown; name?: unknown; input?: unknown; result?: ToolResult };
type PreservedMessage = {
  role?: unknown;
  content?: unknown;
  toolCalls?: CoreToolCall[];
  toolResults?: CoreToolResult[];
};

/**
 * Extracts text content from an array of content blocks.
 * Filters for text type blocks and joins them with newlines.
 */
function extractTextFromContentBlocks(content: unknown[]): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is TextBlock => {
      if (!b || typeof b !== 'object') return false;
      const block = b as ContentBlockShape;
      return block.type === 'text' && typeof block.text === 'string';
    })
    .map((b) => b.text)
    .join('\n');
}

/**
 * Extracts content blocks from a prompt, preserving both text and image blocks.
 * Returns string if only text blocks, array if any images present.
 */
function extractContentBlocks(content: unknown): string | ContentBlock[] {
  if (!Array.isArray(content)) {
    if (typeof content === 'string') return content;
    return '';
  }

  const blocks: ContentBlock[] = [];
  let hasImages = false;

  for (const block of content) {
    if (!block || typeof block !== 'object') continue;

    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') {
      blocks.push({ type: 'text', text: b.text });
    } else if (b.type === 'image' && b.source && typeof b.source === 'object') {
      const source = b.source as Record<string, unknown>;
      if (
        source.type === 'base64' &&
        typeof source.media_type === 'string' &&
        typeof source.data === 'string'
      ) {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: source.media_type,
            data: source.data,
          },
        });
        hasImages = true;
      }
    }
  }

  // If no images, return simple string for backward compatibility
  if (!hasImages) {
    return blocks
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  return blocks;
}

/**
 * Defensive post-pass for messages rebuilt from a `context_compacted` event's
 * `preserved` array. Drops `toolResult` entries from `user` messages when the
 * immediately-prior message is not an `assistant` carrying a matching `tool_use`
 * id. Anthropic rejects orphaned tool_results with a 400; this pass keeps a
 * broken preserved array from bricking a session at read time.
 *
 * If a user message ends up with no toolResults and empty content, it is dropped.
 * Every dropped toolResult is logged at WARN with its toolCallId for visibility.
 */
function dropOrphanedToolResults(messages: ProviderMessage[]): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'user' || !Array.isArray(m.toolResults) || m.toolResults.length === 0) continue;

    const prev = messages[i - 1];
    const priorCallIds =
      prev && prev.role === 'assistant' && Array.isArray(prev.toolCalls)
        ? new Set(prev.toolCalls.map((c) => c.id))
        : new Set<string>();

    const kept: CoreToolResult[] = [];
    for (const tr of m.toolResults) {
      if (tr.id && priorCallIds.has(tr.id)) {
        kept.push(tr);
      } else {
        logger.warn('Dropping orphaned tool_result from compacted preserved messages', {
          toolCallId: tr.id ?? '<missing>',
        });
      }
    }

    if (kept.length === 0) {
      delete m.toolResults;
    } else {
      m.toolResults = kept;
    }

    const contentIsEmpty =
      typeof m.content === 'string' ? m.content.trim() === '' : m.content.length === 0;
    const hasToolResults = Array.isArray(m.toolResults) && m.toolResults.length > 0;
    if (!hasToolResults && contentIsEmpty) {
      messages.splice(i, 1);
    }
  }
}

/**
 * Return type for buildProviderMessagesFromDurableEvents.
 * systemPrompt is sourced exclusively from system_prompt_set events (last one wins).
 * Sessions without a system_prompt_set event return systemPrompt: ''.
 */
export type BuiltProviderMessages = {
  messages: ProviderMessage[];
  systemPrompt: string;
};

/**
 * Builds provider messages from durable events stored in a session directory.
 * Reconstructs the conversation history by reading and parsing events.jsonl.
 * Exported for testing - converts durable events to provider message format.
 *
 * Returns { messages, systemPrompt } where systemPrompt comes from the last
 * system_prompt_set event in the log. Sessions without a system_prompt_set
 * event return systemPrompt: ''.
 */
export function buildProviderMessagesFromDurableEvents(sessionDir: string): BuiltProviderMessages {
  const eventsPath = join(sessionDir, 'events.jsonl');
  let raw = '';
  try {
    raw = readFileSync(eventsPath, 'utf8');
  } catch {
    return { messages: [], systemPrompt: '' };
  }

  // Parse all lines once and reuse in both passes.
  type ParsedEvent = { type: string; data: Record<string, unknown> };
  const parsedEvents: ParsedEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as { type?: string; data?: Record<string, unknown> };
      const type = typeof parsed.type === 'string' ? parsed.type : '';
      const data = typeof parsed.data === 'object' && parsed.data ? parsed.data : {};
      parsedEvents.push({ type, data });
    } catch {
      // Ignore malformed lines.
    }
  }

  // Pass 1: determine systemPrompt from system_prompt_set events (last one wins).
  let systemPrompt = '';
  let systemPromptSetCount = 0;
  for (const e of parsedEvents) {
    if (e.type === 'system_prompt_set') {
      const eventData = e.data as SystemPromptSetData;
      if (typeof eventData.text === 'string') {
        systemPrompt = eventData.text; // last-one-wins for defensive multi-event support
        systemPromptSetCount++;
      }
    }
  }
  if (systemPromptSetCount > 1) {
    // The system_prompt_set invariant ("written once at session creation") has
    // been violated. We still use the last value (defensive last-wins), but we
    // surface the violation so it can be investigated.
    logger.warn('Multiple system_prompt_set events found in session — invariant violation', {
      sessionDir,
      count: systemPromptSetCount,
    });
  }

  // Pass 2: build the messages array.
  const messages: ProviderMessage[] = [];

  for (const e of parsedEvents) {
    const { type, data } = e;

    if (type === 'system_prompt_set') {
      // Already consumed in Pass 1 — skip here.
      continue;
    }

    if (type === 'prompt') {
      const content = extractContentBlocks((data as Record<string, unknown>).content);
      // Check if content is non-empty (string or array with items)
      const hasContent = typeof content === 'string' ? content.trim() : content.length > 0;
      if (hasContent) messages.push({ role: 'user', content });
      continue;
    }

    if (type === 'context_injected') {
      // Emit as role:user so runtime context is visible to the model in the
      // messages array while remaining distinct from the stable system prompt.
      // Use appendOrMergeUser to avoid consecutive role:user messages when the
      // prior entry is a user[toolResults] turn — Anthropic combines consecutive
      // same-role messages in implementation-defined ways and it disrupts cache reach.
      const eventData = data as ContextInjectedData;
      const contentArr = Array.isArray(eventData.content) ? eventData.content : [];
      const content = extractTextFromContentBlocks(contentArr);
      if (content.trim()) {
        const merged = appendOrMergeUser(messages, content);
        messages.length = 0;
        messages.push(...merged);
      }
      continue;
    }

    if (type === 'context_compacted') {
      const eventData = data as ContextCompactedData;
      const summary = typeof eventData.summary === 'string' ? eventData.summary : '';
      const preserved = Array.isArray(eventData.preserved) ? eventData.preserved : [];

      messages.length = 0;
      if (summary.trim())
        messages.push({
          role: 'user',
          content: summary,
        });

      for (const msg of preserved) {
        if (!msg || typeof msg !== 'object') continue;
        const msgObj = msg as PreservedMessage;
        const role = msgObj.role;
        const content = msgObj.content;
        if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
        if (typeof content !== 'string') continue;

        const toolCalls = Array.isArray(msgObj.toolCalls) ? msgObj.toolCalls : undefined;
        const toolResults = Array.isArray(msgObj.toolResults) ? msgObj.toolResults : undefined;

        messages.push({
          role,
          content,
          ...(toolCalls ? { toolCalls } : {}),
          ...(toolResults ? { toolResults } : {}),
        });
      }

      dropOrphanedToolResults(messages);

      continue;
    }

    if (type === 'message') {
      const eventData = data as MessageData;
      const content =
        typeof eventData.content === 'string'
          ? eventData.content
          : extractTextFromContentBlocks(Array.isArray(eventData.content) ? eventData.content : []);
      messages.push({ role: 'assistant', content: content ?? '' });
      continue;
    }

    if (type === 'tool_use') {
      const eventData = data as ToolUseData;
      const toolCallId = toNonEmptyString(eventData.toolCallId);
      const name = toNonEmptyString(eventData.name);
      const input = eventData.input;
      const result = eventData.result;
      if (!toolCallId || !name) continue;

      const toolCall: CoreToolCall = {
        id: toolCallId,
        name,
        arguments: typeof input === 'object' && input ? (input as Record<string, unknown>) : {},
      };

      if (messages.length === 0 || messages[messages.length - 1]!.role !== 'assistant') {
        messages.push({ role: 'assistant', content: '', toolCalls: [toolCall] });
      } else {
        const last = messages[messages.length - 1]!;
        last.toolCalls = [...(last.toolCalls || []), toolCall];
      }

      if (result) {
        const coreResult = coreToolResultFromProtocol(result, toolCallId);
        const last = messages[messages.length - 1];
        const canAppendToUser =
          last && last.role === 'user' && last.toolResults && last.toolResults.length > 0;
        if (canAppendToUser) {
          last.toolResults!.push(coreResult);
        } else {
          messages.push({ role: 'user', content: '', toolResults: [coreResult] });
        }
      }

      continue;
    }
  }

  return { messages, systemPrompt };
}

/**
 * Estimates the total token count for a set of provider messages.
 * Includes content tokens, tool call tokens, and tool result tokens.
 */
export function estimateProviderTokens(messages: ProviderMessage[]): number {
  let total = 0;
  for (const message of messages) {
    if (typeof message.content === 'string') {
      total += estimateTokens(message.content);
    } else {
      // Count tokens for text blocks only (images don't count as text tokens)
      const textContent = message.content
        .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      total += estimateTokens(textContent);
    }
    if (message.toolCalls) {
      total += estimateTokens(JSON.stringify(message.toolCalls));
    }
    if (message.toolResults) {
      total += estimateTokens(JSON.stringify(message.toolResults));
    }
  }
  return total;
}
