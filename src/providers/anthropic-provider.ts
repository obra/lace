// ABOUTME: Anthropic Claude provider implementation
// ABOUTME: Wraps Anthropic SDK in the common provider interface

import Anthropic from '@anthropic-ai/sdk';
import {
  AIProvider,
  ProviderMessage,
  ProviderResponse,
  ProviderConfig,
  ProviderToolCall,
} from './types.js';
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

  get supportsStreaming(): boolean {
    return true;
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

  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[] = []
  ): Promise<ProviderResponse> {
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

    logger.debug('Sending streaming request to Anthropic', {
      provider: 'anthropic',
      model: requestPayload.model,
      messageCount: anthropicMessages.length,
      systemPromptLength: systemPrompt.length,
      toolCount: anthropicTools.length,
      toolNames: anthropicTools.map((t) => t.name),
    });

    // Use the streaming API
    const stream = this._anthropic.messages.stream(requestPayload);

    let toolCalls: ProviderToolCall[] = [];

    try {
      // Handle streaming events - use the 'text' event for token-by-token streaming
      stream.on('text', (text) => {
        // Emit token events for real-time display
        this.emit('token', { token: text });
      });

      // Wait for the stream to complete and get the final message
      const finalMessage = await stream.finalMessage();

      // Extract text content from the final message
      const textContent = finalMessage.content
        .filter((content): content is Anthropic.TextBlock => content.type === 'text')
        .map((content) => content.text)
        .join('');

      // Extract tool calls from the final message
      toolCalls = finalMessage.content
        .filter((content): content is Anthropic.ToolUseBlock => content.type === 'tool_use')
        .map((content) => ({
          id: content.id,
          name: content.name,
          input: content.input as Record<string, unknown>,
        }));

      logger.debug('Received streaming response from Anthropic', {
        provider: 'anthropic',
        contentLength: textContent.length,
        toolCallCount: toolCalls.length,
        toolCallNames: toolCalls.map((tc) => tc.name),
        usage: finalMessage.usage,
      });

      const response = {
        content: textContent,
        toolCalls,
      };

      // Emit completion event
      this.emit('complete', { response });

      return response;
    } catch (error) {
      const errorObj = error as Error;
      logger.error('Streaming error from Anthropic', { error: errorObj.message });
      this.emit('error', { error: errorObj });
      throw error;
    }
  }
}
