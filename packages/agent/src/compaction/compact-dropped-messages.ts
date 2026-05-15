import {
  AIProvider,
  type ConversationState,
  type ProviderMessage,
  type WireTool,
  type RequestOptions,
} from '../providers/base-provider';
import type { Tool as CoreTool } from '@lace/agent/tools/tool';
import type { LaceEvent } from '@lace/agent/threads/types';
import type { CompactionContext, CompactionStrategy } from './types';
import { registerDefaultStrategies } from './registry';
import { getTextContent } from '@lace/agent/providers/utils/content-helpers';

/**
 * Wraps an inner AIProvider to force a specific model on every call. We override the
 * `_createResponseImpl` / `_createStreamingResponseImpl` hooks so the wrapper participates
 * in the base class's tool-name sanitization (sanitization happens once at the outer
 * boundary), then forwards the already-sanitized payload straight to the inner
 * provider's wire-level implementation via `inner._createResponseImpl` — the public
 * `inner.createResponse` would re-sanitize redundantly.
 */
class ModelPinnedProvider extends AIProvider {
  constructor(
    private readonly inner: AIProvider,
    private readonly pinnedModelId: string
  ) {
    super(inner.config);
  }

  isConfigured(): boolean {
    return this.inner.isConfigured();
  }

  get providerName(): string {
    return this.inner.providerName;
  }

  getProviderInfo() {
    return this.inner.getProviderInfo();
  }

  override get supportsStreaming(): boolean {
    return this.inner.supportsStreaming;
  }

  protected override async _createResponseImpl(
    messages: ProviderMessage[],
    tools: WireTool[],
    _model: string,
    signal?: AbortSignal,
    conversationState?: ConversationState,
    options?: RequestOptions
  ) {
    return await this.inner._invokeCreateResponseImpl(
      messages,
      tools,
      this.pinnedModelId,
      signal,
      conversationState,
      options
    );
  }

  protected override async _createStreamingResponseImpl(
    messages: ProviderMessage[],
    tools: WireTool[],
    _model: string,
    signal?: AbortSignal,
    conversationState?: ConversationState,
    options?: RequestOptions
  ) {
    return await this.inner._invokeCreateStreamingResponseImpl(
      messages,
      tools,
      this.pinnedModelId,
      signal,
      conversationState,
      options
    );
  }
}

const compactionStrategiesById = new Map<string, CompactionStrategy>();
registerDefaultStrategies((strategy) => {
  compactionStrategiesById.set(strategy.id, strategy);
});

function laceEventsFromProviderMessages(
  messages: ProviderMessage[],
  threadId: string
): LaceEvent[] {
  const events: LaceEvent[] = [];

  for (const message of messages) {
    const textContent = getTextContent(message.content);
    if (message.role === 'system') {
      if (textContent.trim()) {
        events.push({ type: 'SYSTEM_PROMPT', data: textContent, context: { threadId } });
      }
      continue;
    }

    if (message.role === 'user') {
      if (textContent.trim()) {
        events.push({ type: 'USER_MESSAGE', data: textContent, context: { threadId } });
      }

      const toolResults = Array.isArray(message.toolResults) ? message.toolResults : [];
      for (const toolResult of toolResults) {
        events.push({ type: 'TOOL_RESULT', data: toolResult, context: { threadId } });
      }

      continue;
    }

    if (message.role === 'assistant') {
      if (textContent.trim()) {
        events.push({
          type: 'AGENT_MESSAGE',
          data: { content: textContent },
          context: { threadId },
        });
      }

      const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
      for (const toolCall of toolCalls) {
        events.push({ type: 'TOOL_CALL', data: toolCall, context: { threadId } });
      }
    }
  }

  return events;
}

import type { ToolCall, ToolResult } from '@lace/agent/tools/types';

// Typed shapes for LaceEvent data - these allow proper narrowing
type AgentMessageData = { content?: string } | string;

function providerMessagesFromLaceEvents(events: LaceEvent[]): ProviderMessage[] {
  const messages: ProviderMessage[] = [];

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;

    if (event.type === 'SYSTEM_PROMPT' || event.type === 'USER_SYSTEM_PROMPT') {
      const content = typeof event.data === 'string' ? event.data : '';
      if (content.trim()) messages.push({ role: 'system', content });
      continue;
    }

    if (event.type === 'USER_MESSAGE') {
      const content = typeof event.data === 'string' ? event.data : '';
      if (content.trim()) messages.push({ role: 'user', content });
      continue;
    }

    if (event.type === 'AGENT_MESSAGE') {
      const data = event.data as AgentMessageData;
      const content =
        typeof data === 'string' ? data : typeof data?.content === 'string' ? data.content : '';
      messages.push({ role: 'assistant', content });
      continue;
    }

    if (event.type === 'TOOL_CALL') {
      // Cast to ToolCall - LaceEvent data is assumed to have correct shape at runtime
      const toolCall = event.data as ToolCall;
      if (!toolCall || typeof toolCall !== 'object') continue;

      if (messages.length === 0 || messages[messages.length - 1]!.role !== 'assistant') {
        messages.push({ role: 'assistant', content: '', toolCalls: [toolCall] });
      } else {
        const last = messages[messages.length - 1]!;
        last.toolCalls = [...(last.toolCalls || []), toolCall];
      }

      continue;
    }

    if (event.type === 'TOOL_RESULT') {
      // Cast to ToolResult - LaceEvent data is assumed to have correct shape at runtime
      const toolResult = event.data as ToolResult;
      if (!toolResult || typeof toolResult !== 'object') continue;

      const last = messages[messages.length - 1];
      const canAppendToUser =
        last && last.role === 'user' && last.toolResults && last.toolResults.length > 0;
      if (canAppendToUser) {
        last.toolResults!.push(toolResult);
      } else {
        messages.push({ role: 'user', content: '', toolResults: [toolResult] });
      }

      continue;
    }
  }

  return messages;
}

export async function compactDroppedMessagesWithCore(options: {
  strategyId: 'trim-tool-results' | 'summarize';
  dropped: ProviderMessage[];
  provider?: AIProvider;
  modelId?: string;
  threadId: string;
}): Promise<{ messages: ProviderMessage[]; summary?: string }> {
  if (options.dropped.length === 0) return { messages: [] };

  const strategy = compactionStrategiesById.get(options.strategyId);
  if (!strategy) {
    throw new Error(`Unknown compaction strategy: ${options.strategyId}`);
  }

  const events = laceEventsFromProviderMessages(options.dropped, options.threadId);

  let context: CompactionContext = { threadId: options.threadId };
  if (options.strategyId === 'summarize') {
    if (!options.provider || !options.modelId) {
      throw new Error('summarize compaction requires provider + modelId');
    }
    context = {
      threadId: options.threadId,
      provider: new ModelPinnedProvider(options.provider, options.modelId),
    };
  }

  const result = await strategy.compact(events, context);
  const messages = providerMessagesFromLaceEvents(result.compactedEvents);

  // Extract summary from compaction event metadata
  type CompactionEventMeta = { metadata?: { summary?: string } };
  const eventData = result.compactionEvent.data as CompactionEventMeta | undefined;
  const meta = eventData?.metadata;
  const summary = typeof meta?.summary === 'string' ? meta.summary : undefined;
  return { messages, summary };
}
