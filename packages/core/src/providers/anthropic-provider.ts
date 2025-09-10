// ABOUTME: Anthropic Claude provider implementation
// ABOUTME: Wraps Anthropic SDK in the common provider interface

import Anthropic from '@anthropic-ai/sdk';
import { AIProvider } from '~/providers/base-provider';
import {
  ProviderMessage,
  ProviderResponse,
  ProviderConfig,
  ProviderInfo,
} from '~/providers/base-provider';
import { ToolCall } from '~/tools/types';
import { Tool } from '~/tools/tool';
import { logger } from '~/utils/logger';
import { logProviderRequest, logProviderResponse } from '~/utils/provider-logging';
import { convertToAnthropicFormat } from '~/providers/format-converters';

interface AnthropicProviderConfig extends ProviderConfig {
  apiKey: string | null;
  [key: string]: unknown; // Allow for additional properties
}

export class AnthropicProvider extends AIProvider {
  private _anthropic: Anthropic | null = null;

  constructor(config: AnthropicProviderConfig) {
    super(config);
  }

  private getAnthropicClient(): Anthropic {
    if (!this._anthropic) {
      const config = this._config as AnthropicProviderConfig;
      if (!config.apiKey) {
        throw new Error(
          'Missing API key for Anthropic provider. Please ensure the provider instance has valid credentials.'
        );
      }

      const anthropicConfig: {
        apiKey: string;
        dangerouslyAllowBrowser: boolean;
        baseURL?: string;
      } = {
        apiKey: config.apiKey,
        dangerouslyAllowBrowser: true, // Allow in test environments
      };

      // Support custom base URL for Anthropic-compatible APIs
      const configBaseURL = config.baseURL as string | undefined;
      if (configBaseURL) {
        anthropicConfig.baseURL = configBaseURL;
        logger.info('Using custom Anthropic base URL', { baseURL: configBaseURL });
      }

      this._anthropic = new Anthropic(anthropicConfig);
    }
    return this._anthropic;
  }

  // Provider-specific token counting using Anthropic's beta API
  async countTokens(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    model?: string
  ): Promise<number | null> {
    if (!model) {
      return null; // Can't count without model
    }
    try {
      // Convert to Anthropic format
      const anthropicMessages = convertToAnthropicFormat(messages);
      const systemPrompt = this.getEffectiveSystemPrompt(messages);

      // Convert tools to Anthropic format
      const anthropicTools: Anthropic.Tool[] = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));

      // Use beta API to count tokens
      const result = await this.getAnthropicClient().beta.messages.countTokens({
        model,
        messages: anthropicMessages,
        system: systemPrompt,
        tools: anthropicTools,
      });

      return result.input_tokens;
    } catch (error) {
      logger.debug('Token counting failed, falling back to estimation', { error });
      return null; // Fall back to estimation
    }
  }

  get providerName(): string {
    return 'anthropic';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  private _createRequestPayload(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string
  ): Anthropic.Messages.MessageCreateParams {
    // Convert our enhanced generic messages to Anthropic format
    const anthropicMessages = convertToAnthropicFormat(messages);

    // Extract system message if present
    const systemPrompt = this.getEffectiveSystemPrompt(messages);

    // Convert tools to Anthropic format
    const anthropicTools: Anthropic.Tool[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));

    const payload = {
      model,
      max_tokens: this._config.maxTokens || 4000,
      messages: anthropicMessages,
      system: systemPrompt,
      tools: anthropicTools,
    };

    // Comprehensive debug logging of request metadata (excluding message content)
    logger.info('🔍 ANTHROPIC REQUEST METADATA', {
      model: payload.model,
      maxTokens: payload.max_tokens,
      messageCount: payload.messages.length,
      systemPromptLength: payload.system?.length || 0,
      systemPromptPreview: payload.system?.substring(0, 100) + '...',
      toolCount: payload.tools?.length || 0,
      toolNames: payload.tools?.map((t) => t.name),
      configKeys: Object.keys(this._config),
      providerName: this.providerName,
    });

    return payload;
  }

  async createResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    model: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    return this.withRetry(
      async () => {
        const requestPayload = this._createRequestPayload(messages, tools, model);

        // Log request with pretty formatting
        logProviderRequest('anthropic', requestPayload as unknown as Record<string, unknown>);

        const response = (await this.getAnthropicClient().messages.create(requestPayload, {
          signal,
        })) as Anthropic.Messages.Message;

        // Log response with pretty formatting
        logProviderResponse('anthropic', response);

        const textContent = (response.content || [])
          .filter(
            (contentBlock): contentBlock is Anthropic.TextBlock => contentBlock.type === 'text'
          )
          .map((contentBlock) => contentBlock.text)
          .join('');

        const toolCalls: ToolCall[] = (response.content || [])
          .filter(
            (contentBlock): contentBlock is Anthropic.ToolUseBlock =>
              contentBlock.type === 'tool_use'
          )
          .map((contentBlock) => ({
            id: contentBlock.id,
            name: contentBlock.name,
            arguments: contentBlock.input as Record<string, unknown>,
          }));

        const normalizedUsage = response.usage
          ? {
              promptTokens: response.usage.input_tokens,
              completionTokens: response.usage.output_tokens,
              totalTokens: response.usage.input_tokens + response.usage.output_tokens,
            }
          : undefined;

        logger.debug('Received response from Anthropic', {
          provider: 'anthropic',
          contentLength: textContent.length,
          toolCallCount: toolCalls.length,
          toolCallNames: toolCalls.map((tc) => tc.name),
          rawUsage: response.usage,
          normalizedUsage,
        });

        return {
          content: textContent,
          toolCalls,
          stopReason: this.normalizeStopReason(response.stop_reason),
          usage: normalizedUsage,
        };
      },
      { signal }
    );
  }

  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    model: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    let streamingStarted = false;
    let streamCreated = false;

    return this.withRetry(
      async () => {
        const requestPayload = this._createRequestPayload(messages, tools, model);

        // Log streaming request with pretty formatting
        logProviderRequest('anthropic', requestPayload as unknown as Record<string, unknown>, {
          streaming: true,
        });

        // Use the streaming API
        const stream = this.getAnthropicClient().messages.stream(requestPayload, {
          signal,
        });

        // Mark that stream is created to prevent retries after this point
        streamCreated = true;

        let toolCalls: ToolCall[] = [];

        try {
          // Handle streaming events - use the 'text' event for token-by-token streaming
          stream.on('text', (text) => {
            streamingStarted = true; // Mark that streaming has begun
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
          const textContent = (finalMessage.content || [])
            .filter((content): content is Anthropic.TextBlock => content.type === 'text')
            .map((content) => content.text)
            .join('');

          // Extract tool calls from the final message
          toolCalls = (finalMessage.content || [])
            .filter((content): content is Anthropic.ToolUseBlock => content.type === 'tool_use')
            .map((content) => ({
              id: content.id,
              name: content.name,
              arguments: content.input as Record<string, unknown>,
            }));

          // Log streaming response with pretty formatting
          logProviderResponse('anthropic', finalMessage, { streaming: true });

          logger.debug('Received streaming response from Anthropic', {
            provider: 'anthropic',
            contentLength: textContent.length,
            toolCallCount: toolCalls.length,
            toolCallNames: toolCalls.map((tc: ToolCall) => tc.name),
            usage: finalMessage.usage,
          });

          const response = {
            content: textContent,
            toolCalls,
            stopReason: this.normalizeStopReason(finalMessage.stop_reason),
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
          throw error;
        }
      },
      {
        signal,
        isStreaming: true,
        canRetry: () => !streamCreated && !streamingStarted,
      }
    );
  }

  protected normalizeStopReason(stopReason: string | null | undefined): string | undefined {
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

  getProviderInfo(): ProviderInfo {
    return {
      name: 'anthropic',
      displayName: 'Anthropic Claude',
      requiresApiKey: true,
      configurationHint: 'Set ANTHROPIC_KEY environment variable or pass apiKey in config',
    };
  }

  isConfigured(): boolean {
    const config = this._config as AnthropicProviderConfig;
    return !!config.apiKey && config.apiKey.length > 0;
  }
}
