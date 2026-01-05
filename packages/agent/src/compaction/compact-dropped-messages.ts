import {
  AIProvider,
  type ConversationState,
  type ProviderMessage,
} from '../providers/base-provider';
import type { Tool as CoreTool } from '@lace/agent/tools/tool';
import type { LaceEvent } from '@lace/agent/threads/types';
import type { CompactionStrategy } from './types';
import { registerDefaultStrategies } from './registry';

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

  override async createResponse(
    messages: ProviderMessage[],
    tools: CoreTool[],
    _model: string,
    signal?: AbortSignal,
    conversationState?: ConversationState
  ) {
    return await this.inner.createResponse(
      messages,
      tools,
      this.pinnedModelId,
      signal,
      conversationState
    );
  }

  override async createStreamingResponse(
    messages: ProviderMessage[],
    tools: CoreTool[],
    _model: string,
    signal?: AbortSignal,
    conversationState?: ConversationState
  ) {
    return await this.inner.createStreamingResponse(
      messages,
      tools,
      this.pinnedModelId,
      signal,
      conversationState
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
    if (message.role === 'system') {
      if (message.content.trim()) {
        events.push({ type: 'SYSTEM_PROMPT', data: message.content, context: { threadId } });
      }
      continue;
    }

    if (message.role === 'user') {
      if (message.content.trim()) {
        events.push({ type: 'USER_MESSAGE', data: message.content, context: { threadId } });
      }

      const toolResults = Array.isArray(message.toolResults) ? message.toolResults : [];
      for (const toolResult of toolResults) {
        events.push({ type: 'TOOL_RESULT', data: toolResult, context: { threadId } });
      }

      continue;
    }

    if (message.role === 'assistant') {
      if (message.content.trim()) {
        events.push({
          type: 'AGENT_MESSAGE',
          data: { content: message.content },
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
      const data = event.data as any;
      const content =
        typeof data === 'string' ? data : typeof data?.content === 'string' ? data.content : '';
      messages.push({ role: 'assistant', content });
      continue;
    }

    if (event.type === 'TOOL_CALL') {
      const toolCall = event.data as any;
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
      const toolResult = event.data as any;
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

  let context: any = { threadId: options.threadId };
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
  const meta = (result.compactionEvent.data as any)?.metadata;
  const summary = typeof meta?.summary === 'string' ? meta.summary : undefined;
  return { messages, summary };
}
