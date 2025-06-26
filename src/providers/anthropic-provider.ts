// ABOUTME: Anthropic Claude provider implementation
// ABOUTME: Wraps Anthropic SDK in the common provider interface

import Anthropic from '@anthropic-ai/sdk';
import { AIProvider } from './base-provider.js';
import {
  ProviderMessage,
  ProviderResponse,
  ProviderConfig,
  ProviderToolCall,
} from './base-provider.js';
import { Tool } from '../tools/types.js';
import { logger } from '../utils/logger.js';
import { convertToAnthropicFormat } from './format-converters.js';

export interface AnthropicProviderConfig extends ProviderConfig {
  apiKey: string;
  [key: string]: unknown; // Allow for additional properties
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

  

  private _createRequestPayload(messages: ProviderMessage[], tools: Tool[]): Anthropic.Messages.MessageCreateParams {
    // Convert our enhanced generic messages to Anthropic format
    const anthropicMessages = convertToAnthropicFormat(messages);

    // Extract system message if present
    const systemPrompt = this.getEffectiveSystemPrompt(messages);

    // Convert tools to Anthropic format
    const anthropicTools: Anthropic.Tool[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));

    return {
      model: this.modelName,
      max_tokens: this._config.maxTokens || 4000,
      messages: anthropicMessages,
      system: systemPrompt,
      tools: anthropicTools,
    };
  }

  async createResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    const requestPayload = this._createRequestPayload(messages, tools);

    logger.debug('Sending request to Anthropic', {
      provider: 'anthropic',
      model: requestPayload.model,
      messageCount: requestPayload.messages.length,
      systemPromptLength: requestPayload.system?.length,
      toolCount: requestPayload.tools?.length,
      toolNames: requestPayload.tools?.map((t) => t.name),
    });

    // Log full request payload for debugging
    logger.debug('Anthropic request payload', {
      provider: 'anthropic',
      payload: JSON.stringify(requestPayload, null, 2),
    });

    const response = (await this._anthropic.messages.create(requestPayload, {
      signal,
    })) as Anthropic.Messages.Message;

    // Log full response for debugging
    logger.debug('Anthropic response payload', {
      provider: 'anthropic',
      response: JSON.stringify(response, null, 2),
    });

    const textContent = response.content
      .filter((contentBlock): contentBlock is Anthropic.TextBlock => contentBlock.type === 'text')
      .map((contentBlock) => contentBlock.text)
      .join('');

    const toolCalls = response.content
      .filter((contentBlock): contentBlock is Anthropic.ToolUseBlock => contentBlock.type === 'tool_use')
      .map((contentBlock) => ({
        id: contentBlock.id,
        name: contentBlock.name,
        input: contentBlock.input as Record<string, unknown>,
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
    const requestPayload = this._createRequestPayload(messages, tools);

    logger.debug('Sending streaming request to Anthropic', {
      provider: 'anthropic',
      model: requestPayload.model,
      messageCount: requestPayload.messages.length,
      systemPromptLength: requestPayload.system?.length,
      toolCount: requestPayload.tools?.length,
      toolNames: requestPayload.tools?.map((t) => t.name),
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

      // Track progressive token estimation
      let estimatedOutputTokens = 0;

      // Listen for progressive token usage updates during streaming
      stream.on('streamEvent', (event) => {
        if (event.type === 'message_delta' && event.usage) {
          const usage = event.usage;
          this.emit('token_usage_update', {
            usage: {
              promptTokens: usage.input_tokens || 0,
              completionTokens: usage.output_tokens || 0,
              totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
            },
          });
        }
      });

      // Estimate progressive tokens from text chunks
      stream.on('text', (text) => {
        // Rough token estimation: ~4 characters per token
        const newTokens = this.estimateTokens(text);
        estimatedOutputTokens += newTokens;

        // Emit progressive token estimate
        this.emit('token_usage_update', {
          usage: {
            promptTokens: 0, // Unknown during streaming
            completionTokens: estimatedOutputTokens,
            totalTokens: estimatedOutputTokens,
          },
        });
      });

      // Listen for message completion to get final token usage
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
        toolCallNames: toolCalls.map((tc: ProviderToolCall) => tc.name),
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
