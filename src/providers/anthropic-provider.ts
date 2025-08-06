// ABOUTME: Anthropic Claude provider implementation
// ABOUTME: Wraps Anthropic SDK in the common provider interface

import Anthropic from '@anthropic-ai/sdk';
import { AIProvider } from '~/providers/base-provider';
import {
  ProviderMessage,
  ProviderResponse,
  ProviderConfig,
  ProviderToolCall,
  ProviderInfo,
  ModelInfo,
} from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { logger } from '~/utils/logger';
import { convertToAnthropicFormat } from '~/providers/format-converters';

export interface AnthropicProviderConfig extends ProviderConfig {
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
  async countTokens(messages: ProviderMessage[], tools: Tool[] = []): Promise<number | null> {
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
        model: this.modelName,
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

  get defaultModel(): string {
    return 'claude-sonnet-4-20250514';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  get contextWindow(): number {
    const model = this.modelName.toLowerCase();

    // All Claude 3 and Claude 4 models support 200k context
    if (model.includes('claude')) {
      return 200000;
    }

    // Fallback to base implementation
    return super.contextWindow;
  }

  get maxCompletionTokens(): number {
    const model = this.modelName.toLowerCase();

    // Claude 4 and Claude 3.7 models support 8192 output tokens
    if (
      model.includes('claude-4') ||
      model.includes('claude-sonnet-4') ||
      model.includes('claude-opus-4') ||
      model.includes('claude-3-7')
    ) {
      return 8192;
    }

    // Claude 3.5 models support 8192 output tokens
    if (model.includes('claude-3-5')) {
      return 8192;
    }

    // Claude 3 models support 4096 output tokens
    if (model.includes('claude-3')) {
      return 4096;
    }

    // Use configured value or fallback
    return this._config.maxTokens || 4096;
  }

  private _createRequestPayload(
    messages: ProviderMessage[],
    tools: Tool[]
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
    return this.withRetry(
      async () => {
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

        const response = (await this.getAnthropicClient().messages.create(requestPayload, {
          signal,
        })) as Anthropic.Messages.Message;

        // Log full response for debugging
        logger.debug('Anthropic response payload', {
          provider: 'anthropic',
          response: JSON.stringify(response, null, 2),
        });

        const textContent = response.content
          .filter(
            (contentBlock): contentBlock is Anthropic.TextBlock => contentBlock.type === 'text'
          )
          .map((contentBlock) => contentBlock.text)
          .join('');

        const toolCalls = response.content
          .filter(
            (contentBlock): contentBlock is Anthropic.ToolUseBlock =>
              contentBlock.type === 'tool_use'
          )
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
          stopReason: this.normalizeStopReason(response.stop_reason),
          usage: response.usage
            ? {
                promptTokens: response.usage.input_tokens,
                completionTokens: response.usage.output_tokens,
                totalTokens: response.usage.input_tokens + response.usage.output_tokens,
              }
            : undefined,
        };
      },
      { signal }
    );
  }

  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    let streamingStarted = false;
    let streamCreated = false;

    return this.withRetry(
      async () => {
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
        const stream = this.getAnthropicClient().messages.stream(requestPayload, {
          signal,
        });

        // Mark that stream is created to prevent retries after this point
        streamCreated = true;

        let toolCalls: ProviderToolCall[] = [];

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
          // Emit error event for compatibility with existing tests
          this.emit('error', { error: errorObj });
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

  getAvailableModels(): ModelInfo[] {
    return [
      // Claude 4 Series (Latest - May 2025)
      {
        id: 'claude-sonnet-4-20250514',
        displayName: 'Claude Sonnet 4',
        description: 'Latest Sonnet model with hybrid reasoning capabilities',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        capabilities: ['vision', 'function-calling', 'reasoning'],
        isDefault: true,
      },
      {
        id: 'claude-opus-4-20250514',
        displayName: 'Claude Opus 4',
        description: "World's best coding model with sustained performance",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        capabilities: ['vision', 'function-calling', 'coding', 'reasoning'],
      },
      // Claude 3.7 Series (February 2025)
      {
        id: 'claude-3-7-sonnet-20250224',
        displayName: 'Claude 3.7 Sonnet',
        description: 'Pioneering hybrid AI reasoning model',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        capabilities: ['vision', 'function-calling', 'reasoning'],
      },
      // Claude 3.5 Series (Current Generation)
      {
        id: 'claude-3-5-sonnet-20241022',
        displayName: 'Claude 3.5 Sonnet',
        description: 'High-performance model with enhanced capabilities',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        capabilities: ['vision', 'function-calling'],
      },
      {
        id: 'claude-3-5-haiku-20241022',
        displayName: 'Claude 3.5 Haiku',
        description: 'Fast model matching Claude 3 Opus performance',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        capabilities: ['function-calling'],
      },
      // Claude 3 Series (Legacy)
      {
        id: 'claude-3-opus-20240229',
        displayName: 'Claude 3 Opus',
        description: 'Powerful model for complex analysis',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        capabilities: ['vision', 'function-calling'],
      },
      {
        id: 'claude-3-sonnet-20240229',
        displayName: 'Claude 3 Sonnet (Legacy)',
        description: 'Legacy model - use claude-sonnet-4-20250514 instead',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        capabilities: ['vision', 'function-calling'],
      },
      {
        id: 'claude-3-haiku-20240307',
        displayName: 'Claude 3 Haiku (Legacy)',
        description: 'Legacy model - use claude-3-5-haiku-20241022 instead',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        capabilities: ['vision', 'function-calling'],
      },
    ];
  }

  isConfigured(): boolean {
    const config = this._config as AnthropicProviderConfig;
    return !!config.apiKey && config.apiKey.length > 0;
  }
}
