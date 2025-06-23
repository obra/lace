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
import { convertToAnthropicFormat } from './format-converters.js';

export interface AnthropicProviderConfig extends ProviderConfig {
  apiKey: string;
}

export class AnthropicProvider extends AIProvider {
  private readonly _anthropic: Anthropic;

  constructor(config: AnthropicProviderConfig) {
    super(config);
    this._anthropic = new Anthropic({
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true, // Allow in test environments
    });
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

  async createResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    // Convert our enhanced generic messages to Anthropic format
    const anthropicMessages = convertToAnthropicFormat(messages);

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

    // Log full request payload for debugging
    logger.debug('Anthropic request payload', {
      provider: 'anthropic',
      payload: JSON.stringify(requestPayload, null, 2),
    });

    const response = await this._anthropic.messages.create(requestPayload, {
      signal,
    });

    // Log full response for debugging
    logger.debug('Anthropic response payload', {
      provider: 'anthropic',
      response: JSON.stringify(response, null, 2),
    });

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
      stopReason: this._normalizeStopReason(response.stop_reason),
      usage: response.usage
        ? {
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
            totalTokens: response.usage.input_tokens + response.usage.output_tokens,
          }
        : undefined,
    };
  }

  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    // Convert our enhanced generic messages to Anthropic format
    const anthropicMessages = convertToAnthropicFormat(messages);

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

    // Log full request payload for debugging
    logger.debug('Anthropic streaming request payload', {
      provider: 'anthropic',
      payload: JSON.stringify(requestPayload, null, 2),
    });

    // Use the streaming API
    const stream = this._anthropic.messages.stream(requestPayload, {
      signal,
    });

    let toolCalls: ProviderToolCall[] = [];

    try {
      // Handle streaming events - use the 'text' event for token-by-token streaming
      stream.on('text', (text) => {
        // Emit token events for real-time display
        this.emit('token', { token: text });
      });

      // Listen for message completion to get token usage
      stream.on('message', (message) => {
        // This fires when the message is complete - provides final token usage
        if (message.usage) {
          this.emit('token_usage_update', {
            usage: {
              promptTokens: message.usage.input_tokens,
              completionTokens: message.usage.output_tokens,
              totalTokens: message.usage.input_tokens + message.usage.output_tokens,
            },
          });
        }
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

      // Log full response for debugging
      logger.debug('Anthropic streaming response payload', {
        provider: 'anthropic',
        response: JSON.stringify(finalMessage, null, 2),
      });

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
        stopReason: this._normalizeStopReason(finalMessage.stop_reason),
        usage: finalMessage.usage
          ? {
              promptTokens: finalMessage.usage.input_tokens,
              completionTokens: finalMessage.usage.output_tokens,
              totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
            }
          : undefined,
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

  private _normalizeStopReason(stopReason: string | null): string | undefined {
    if (!stopReason) return undefined;

    switch (stopReason) {
      case 'max_tokens':
        return 'max_tokens';
      case 'end_turn':
        return 'stop';
      case 'tool_use':
        return 'tool_use';
      case 'stop_sequence':
        return 'stop';
      default:
        return 'stop';
    }
  }
}
