// ABOUTME: Anthropic Claude provider implementation
// ABOUTME: Wraps Anthropic SDK in the common provider interface

import Anthropic from '@anthropic-ai/sdk';
import { AIProvider, ProviderMessage, ProviderResponse, ProviderConfig } from './types.js';
import { Tool } from '../tools/types.js';
import { logger } from '../utils/logger.js';

export interface AnthropicProviderConfig extends ProviderConfig {
  apiKey: string;
}

export class AnthropicProvider extends AIProvider {
  private readonly _anthropic: Anthropic;

  constructor(config: AnthropicProviderConfig) {
    super(config);
    this._anthropic = new Anthropic({ apiKey: config.apiKey });
  }

  get providerName(): string {
    return 'anthropic';
  }

  get defaultModel(): string {
    return 'claude-sonnet-4-20250514';
  }

  async createResponse(messages: ProviderMessage[], tools: Tool[] = []): Promise<ProviderResponse> {
    // Convert our generic messages to Anthropic format
    const anthropicMessages: Anthropic.MessageParam[] = messages
      .filter((msg) => msg.role !== 'system')
      .map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));

    // Extract system message if present
    const systemMessage = messages.find((msg) => msg.role === 'system');
    const systemPrompt =
      systemMessage?.content || this._config.systemPrompt || 'You are a helpful assistant.';

    // Convert tools to Anthropic format
    const anthropicTools: Anthropic.Tool[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));

    const requestPayload = {
      model: this._config.model || this.defaultModel,
      max_tokens: this._config.maxTokens || 4000,
      messages: anthropicMessages,
      system: systemPrompt,
      tools: anthropicTools,
    };

    logger.debug('Sending request to Anthropic', {
      provider: 'anthropic',
      model: requestPayload.model,
      messageCount: anthropicMessages.length,
      systemPromptLength: systemPrompt.length,
      toolCount: anthropicTools.length,
      toolNames: anthropicTools.map((t) => t.name),
    });

    const response = await this._anthropic.messages.create(requestPayload);

    const textContent = response.content
      .filter((content): content is Anthropic.TextBlock => content.type === 'text')
      .map((content) => content.text)
      .join('');

    const toolCalls = response.content
      .filter((content): content is Anthropic.ToolUseBlock => content.type === 'tool_use')
      .map((content) => ({
        id: content.id,
        name: content.name,
        input: content.input as Record<string, unknown>,
      }));

    logger.debug('Received response from Anthropic', {
      provider: 'anthropic',
      contentLength: textContent.length,
      toolCallCount: toolCalls.length,
      toolCallNames: toolCalls.map((tc) => tc.name),
      usage: response.usage,
    });

    return {
      content: textContent,
      toolCalls,
    };
  }
}
