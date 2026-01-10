// ABOUTME: Message building utilities for converting durable events to provider messages

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolResult, ContextBreakdown, ThreadTokenUsage } from '@lace/ent-protocol';
import type { ContentBlock, ProviderMessage } from '../providers/base-provider';
import { toNonEmptyString, coreToolResultFromProtocol } from '../rpc/utils';
import type { ToolCall as CoreToolCall } from '../tools/types';
import { estimateTokens } from '@lace/agent/utils/token-estimation';

/**
 * Extracts text content from an array of content blocks.
 * Filters for text type blocks and joins them with newlines.
 */
function extractTextFromContentBlocks(content: unknown[]): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (b) =>
        b &&
        typeof b === 'object' &&
        (b as any).type === 'text' &&
        typeof (b as any).text === 'string'
    )
    .map((b) => String((b as any).text))
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
 * Builds provider messages from durable events stored in a session directory.
 * Reconstructs the conversation history by reading and parsing events.jsonl.
 * Exported for testing - converts durable events to provider message format.
 */
export function buildProviderMessagesFromDurableEvents(sessionDir: string): ProviderMessage[] {
  const eventsPath = join(sessionDir, 'events.jsonl');
  let raw = '';
  try {
    raw = readFileSync(eventsPath, 'utf8');
  } catch {
    return [];
  }

  const messages: ProviderMessage[] = [];
  const lines = raw.split('\n');

  for (const line of lines) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as { type?: string; data?: Record<string, unknown> };
      const type = typeof parsed.type === 'string' ? parsed.type : '';
      const data = typeof parsed.data === 'object' && parsed.data ? parsed.data : {};

      if (type === 'prompt') {
        const content = extractContentBlocks((data as Record<string, unknown>).content);
        // Check if content is non-empty (string or array with items)
        const hasContent = typeof content === 'string' ? content.trim() : content.length > 0;
        if (hasContent) messages.push({ role: 'user', content });
        continue;
      }

      if (type === 'context_injected') {
        const content = extractTextFromContentBlocks((data as any).content);
        if (content.trim()) messages.push({ role: 'system', content });
        continue;
      }

      if (type === 'context_compacted') {
        const summary = typeof (data as any).summary === 'string' ? (data as any).summary : '';
        const preserved = Array.isArray((data as any).preserved) ? (data as any).preserved : [];

        messages.length = 0;
        if (summary.trim()) messages.push({ role: 'system', content: summary });

        for (const msg of preserved) {
          if (!msg || typeof msg !== 'object') continue;
          const role = (msg as any).role;
          const content = (msg as any).content;
          if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
          if (typeof content !== 'string') continue;

          const toolCalls = Array.isArray((msg as any).toolCalls)
            ? (msg as any).toolCalls
            : undefined;
          const toolResults = Array.isArray((msg as any).toolResults)
            ? (msg as any).toolResults
            : undefined;

          messages.push({
            role,
            content,
            ...(toolCalls ? { toolCalls } : {}),
            ...(toolResults ? { toolResults } : {}),
          });
        }

        continue;
      }

      if (type === 'message') {
        const content =
          typeof (data as any).content === 'string'
            ? (data as any).content
            : extractTextFromContentBlocks((data as any).content);
        messages.push({ role: 'assistant', content: content ?? '' });
        continue;
      }

      if (type === 'tool_use') {
        const toolCallId = toNonEmptyString((data as any).toolCallId);
        const name = toNonEmptyString((data as any).name);
        const input = (data as any).input;
        const result = (data as any).result as ToolResult | undefined;
        if (!toolCallId || !name) continue;

        const toolCall: CoreToolCall = {
          id: toolCallId,
          name,
          arguments: typeof input === 'object' && input ? (input as any) : {},
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
    } catch {
      // Ignore malformed lines.
    }
  }

  return messages;
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
    if ((message as any).toolCalls)
      total += estimateTokens(JSON.stringify((message as any).toolCalls));
    if ((message as any).toolResults)
      total += estimateTokens(JSON.stringify((message as any).toolResults));
  }
  return total;
}
