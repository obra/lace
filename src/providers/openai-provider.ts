// ABOUTME: OpenAI GPT provider implementation
// ABOUTME: Wraps OpenAI SDK in the common provider interface

import OpenAI, { ClientOptions } from 'openai';
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
import { convertToOpenAIFormat } from '~/providers/format-converters';
import { getEnvVar } from '~/config/env-loader';

export interface OpenAIProviderConfig extends ProviderConfig {
  apiKey: string | null;
  [key: string]: unknown; // Allow for additional properties
}

export class OpenAIProvider extends AIProvider {
  private _openai: OpenAI | null = null;

  constructor(config: OpenAIProviderConfig) {
    super(config);
  }

  private getOpenAIClient(): OpenAI {
    if (!this._openai) {
      const config = this._config as OpenAIProviderConfig;
      if (!config.apiKey) {
        throw new Error('Missing required environment variable: OPENAI_API_KEY or OPENAI_KEY');
      }

      const openaiConfig: ClientOptions = {
        apiKey: config.apiKey,
        dangerouslyAllowBrowser: true, // Allow in test environments
      };

      // Support custom base URL for OpenAI-compatible APIs
      const baseURL = getEnvVar('OPENAI_BASE_URL');
      if (baseURL) {
        openaiConfig.baseURL = baseURL;
        logger.info('Using custom OpenAI base URL', { baseURL });
      }

      this._openai = new OpenAI(openaiConfig);
    }
    return this._openai;
  }

  get providerName(): string {
    return 'openai';
  }

  get defaultModel(): string {
    return 'gpt-4o';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  get contextWindow(): number {
    const model = this.modelName.toLowerCase();

    // GPT-4.1 series with 1M token context
    if (model.includes('gpt-4.1')) {
      return 1000000;
    }

    // GPT-4o and GPT-4-turbo models
    if (model.includes('gpt-4o') || model.includes('gpt-4-turbo')) {
      return 128000;
    }

    // O-series models
    if (model === 'o3' || model === 'o3-pro') {
      return 200000;
    }
    if (model === 'o4-mini' || model.includes('o4-mini')) {
      return 128000;
    }
    if (model === 'o1' || model === 'o1-preview') {
      return 200000;
    }
    if (model === 'o1-mini') {
      return 128000;
    }

    // GPT-3.5-turbo variants
    if (model.includes('gpt-3.5-turbo-16k')) {
      return 16384;
    }
    if (model.includes('gpt-3.5-turbo')) {
      return 16384; // Latest versions support 16k
    }

    // Legacy GPT-4
    if (model === 'gpt-4') {
      return 8192;
    }

    // Fallback to base implementation
    return super.contextWindow;
  }

  get maxCompletionTokens(): number {
    const model = this.modelName.toLowerCase();

    // O-series models have larger output limits
    if (model === 'o3' || model === 'o3-pro') {
      return 100000;
    }
    if (model === 'o4-mini' || model.includes('o4-mini')) {
      return 65536;
    }
    if (model === 'o1' || model === 'o1-preview') {
      return 100000;
    }
    if (model === 'o1-mini') {
      return 65536;
    }

    // GPT-4o models
    if (model.includes('gpt-4o')) {
      return 16384;
    }

    // Most other models default to 4096
    return this._config.maxTokens || 4096;
  }

  private _createRequestPayload(
    messages: ProviderMessage[],
    tools: Tool[],
    stream: boolean
  ): OpenAI.Chat.ChatCompletionCreateParams {
    // Convert our enhanced generic messages to OpenAI format
    const openaiMessages = convertToOpenAIFormat(
      messages
    ) as unknown as OpenAI.Chat.ChatCompletionMessageParam[];

    // Extract system message if present
    const systemPrompt = this.getEffectiveSystemPrompt(messages);

    // Add system message at the beginning if not already present
    const messagesWithSystem = [
      { role: 'system' as const, content: systemPrompt },
      ...openaiMessages.filter((msg) => msg.role !== 'system'),
    ];

    // Convert tools to OpenAI format
    const openaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));

    const requestPayload: OpenAI.Chat.ChatCompletionCreateParams = {
      model: this.modelName,
      messages: messagesWithSystem,
      max_tokens: this._config.maxTokens || 4000,
      stream,
      ...(tools.length > 0 && { tools: openaiTools }),
    };

    return requestPayload;
  }

  async createResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    return this.withRetry(
      async () => {
        const requestPayload = this._createRequestPayload(messages, tools, false);

        logger.debug('Sending request to OpenAI', {
          provider: 'openai',
          model: requestPayload.model,
          messageCount: requestPayload.messages.length,
          systemPromptLength: requestPayload.messages[0].content?.length,
          toolCount: requestPayload.tools?.length,
          toolNames: requestPayload.tools?.map((t) => t.function.name),
        });

        // Log full request payload for debugging
        logger.debug('OpenAI request payload', {
          provider: 'openai',
          payload: JSON.stringify(requestPayload, null, 2),
        });

        const response = (await this.getOpenAIClient().chat.completions.create(requestPayload, {
          signal,
        })) as OpenAI.Chat.ChatCompletion;

        // Log full response for debugging
        logger.debug('OpenAI response payload', {
          provider: 'openai',
          response: JSON.stringify(response, null, 2),
        });

        const choice = response.choices[0];
        if (!choice.message) {
          throw new Error('No message in OpenAI response');
        }

        const textContent = choice.message.content || '';

        const toolCalls: ProviderToolCall[] =
          choice.message.tool_calls?.map((toolCall: OpenAI.Chat.ChatCompletionMessageToolCall) => ({
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments) as Record<string, unknown>,
          })) || [];

        logger.debug('Received response from OpenAI', {
          provider: 'openai',
          contentLength: textContent.length,
          toolCallCount: toolCalls.length,
          toolCallNames: toolCalls.map((tc) => tc.name),
          usage: response.usage,
        });

        return {
          content: textContent,
          toolCalls,
          stopReason: this.normalizeStopReason(choice.finish_reason),
          usage: response.usage
            ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens,
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
        const requestPayload = this._createRequestPayload(messages, tools, true);

        logger.debug('Sending streaming request to OpenAI', {
          provider: 'openai',
          model: requestPayload.model,
          messageCount: requestPayload.messages.length,
          systemPromptLength: requestPayload.messages[0].content?.length,
          toolCount: requestPayload.tools?.length,
          toolNames: requestPayload.tools?.map((t) => t.function.name),
        });

        // Log full request payload for debugging
        logger.debug('OpenAI streaming request payload', {
          provider: 'openai',
          payload: JSON.stringify(requestPayload, null, 2),
        });

        try {
          // Use the streaming API
          const stream = (await this.getOpenAIClient().chat.completions.create(requestPayload, {
            signal,
          })) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;

          // Mark that stream is created to prevent retries after this point
          streamCreated = true;

          let content = '';
          let toolCalls: ProviderToolCall[] = [];
          let stopReason: string | undefined;
          let usage: OpenAI.CompletionUsage | undefined;

          // Accumulate tool calls during streaming
          const partialToolCalls: Map<
            number,
            {
              id: string;
              name: string;
              arguments: string;
            }
          > = new Map();

          // Track progressive token estimation
          let estimatedOutputTokens = 0;

          // Process stream chunks
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;

            if (delta?.content) {
              streamingStarted = true; // Mark that streaming has begun
              content += delta.content;
              // Emit token events for real-time display
              this.emit('token', { token: delta.content });

              // Estimate progressive tokens from text chunks
              const newTokens = this.estimateTokens(delta.content);
              estimatedOutputTokens += newTokens;

              // Emit progressive token estimate
              this.emit('token_usage_update', {
                usage: {
                  promptTokens: 0, // Unknown during streaming
                  completionTokens: estimatedOutputTokens,
                  totalTokens: estimatedOutputTokens,
                },
              });
            }

            // Handle tool calls
            if (delta?.tool_calls) {
              for (const toolCall of delta.tool_calls) {
                const index = toolCall.index;

                if (!partialToolCalls.has(index)) {
                  partialToolCalls.set(index, {
                    id: toolCall.id!,
                    name: toolCall.function!.name!,
                    arguments: '',
                  });
                }

                const partial = partialToolCalls.get(index)!;
                if (toolCall.function?.arguments) {
                  partial.arguments += toolCall.function.arguments;
                }
              }
            }

            // Get finish reason from the last chunk
            if (chunk.choices[0]?.finish_reason) {
              stopReason = chunk.choices[0].finish_reason;
            }

            // Some providers include usage in streaming responses
            if (chunk.usage) {
              usage = chunk.usage;

              // Emit token usage updates during streaming
              this.emit('token_usage_update', {
                usage: {
                  promptTokens: usage.prompt_tokens,
                  completionTokens: usage.completion_tokens,
                  totalTokens: usage.total_tokens,
                },
              });
            }
          }

          // Convert partial tool calls to final format
          toolCalls = Array.from(partialToolCalls.values()).map((partial) => ({
            id: partial.id,
            name: partial.name,
            input: JSON.parse(partial.arguments) as Record<string, unknown>,
          }));

          logger.debug('Received streaming response from OpenAI', {
            provider: 'openai',
            contentLength: content.length,
            toolCallCount: toolCalls.length,
            toolCallNames: toolCalls.map((tc) => tc.name),
            usage,
          });

          const response = {
            content,
            toolCalls,
            stopReason: this.normalizeStopReason(stopReason),
            usage: usage
              ? {
                  promptTokens: usage.prompt_tokens,
                  completionTokens: usage.completion_tokens,
                  totalTokens: usage.total_tokens,
                }
              : undefined,
          };

          // Emit completion event
          this.emit('complete', { response });

          return response;
        } catch (error) {
          const errorObj = error as Error;
          logger.error('Streaming error from OpenAI', { error: errorObj.message });
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
      case 'length':
        return 'max_tokens';
      case 'stop':
        return 'stop';
      case 'tool_calls':
        return 'tool_use';
      case 'content_filter':
        return 'stop';
      default:
        return 'stop';
    }
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: 'openai',
      displayName: 'OpenAI',
      requiresApiKey: true,
      configurationHint: 'Set OPENAI_API_KEY or OPENAI_KEY environment variable',
    };
  }

  getAvailableModels(): ModelInfo[] {
    return [
      // O-Series Reasoning Models (2025)
      {
        id: 'o3',
        displayName: 'OpenAI o3',
        description: 'Most capable reasoning model for complex tasks',
        contextWindow: 200000,
        maxOutputTokens: 100000,
        capabilities: ['reasoning', 'math', 'coding'],
      },
      {
        id: 'o3-pro',
        displayName: 'OpenAI o3 Pro',
        description: 'Enhanced o3 with superior performance',
        contextWindow: 200000,
        maxOutputTokens: 100000,
        capabilities: ['reasoning', 'math', 'coding'],
      },
      {
        id: 'o4-mini',
        displayName: 'OpenAI o4 Mini',
        description: 'Efficient reasoning model optimized for speed and cost',
        contextWindow: 128000,
        maxOutputTokens: 65536,
        capabilities: ['reasoning', 'math', 'coding', 'vision'],
      },
      {
        id: 'o4-mini-high',
        displayName: 'OpenAI o4 Mini High',
        description: 'Premium o4-mini with enhanced accuracy and speed (paid users)',
        contextWindow: 128000,
        maxOutputTokens: 65536,
        capabilities: ['reasoning', 'math', 'coding', 'vision'],
      },
      // GPT Models (2025)
      {
        id: 'gpt-4o',
        displayName: 'GPT-4o',
        description: 'Default flagship model for chat and complex tasks',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        capabilities: ['vision', 'function-calling'],
        isDefault: true,
      },
      {
        id: 'gpt-4.5',
        displayName: 'GPT-4.5',
        description: 'Largest and best model for chat (Pro users)',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        capabilities: ['vision', 'function-calling'],
      },
      {
        id: 'gpt-4.1',
        displayName: 'GPT-4.1',
        description: 'Flagship multimodal model with 1M token context and coding improvements',
        contextWindow: 1000000,
        maxOutputTokens: 16384,
        capabilities: ['vision', 'function-calling', 'coding'],
      },
      {
        id: 'gpt-4.1-mini',
        displayName: 'GPT-4.1 Mini',
        description: 'High performance small model with 1M token context, beats GPT-4o',
        contextWindow: 1000000,
        maxOutputTokens: 16384,
        capabilities: ['vision', 'function-calling'],
      },
      {
        id: 'gpt-4.1-nano',
        displayName: 'GPT-4.1 Nano',
        description: 'Fastest and cheapest model with 1M token context',
        contextWindow: 1000000,
        maxOutputTokens: 4096,
        capabilities: ['function-calling'],
      },
      {
        id: 'gpt-4o-mini',
        displayName: 'GPT-4o Mini',
        description: 'Small, affordable, intelligent model',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        capabilities: ['vision', 'function-calling'],
      },
      // Legacy Models (still available)
      {
        id: 'gpt-4-turbo',
        displayName: 'GPT-4 Turbo',
        description: 'Previous generation GPT-4 with vision',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        capabilities: ['vision', 'function-calling'],
      },
      {
        id: 'gpt-4',
        displayName: 'GPT-4',
        description: 'Original GPT-4 model',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        capabilities: ['function-calling'],
      },
      {
        id: 'gpt-3.5-turbo',
        displayName: 'GPT-3.5 Turbo',
        description: 'Fast, efficient model for simple tasks',
        contextWindow: 16384,
        maxOutputTokens: 4096,
        capabilities: ['function-calling'],
      },
      // Legacy O1 models
      {
        id: 'o1',
        displayName: 'OpenAI o1',
        description: 'Previous generation reasoning model',
        contextWindow: 200000,
        maxOutputTokens: 100000,
        capabilities: ['reasoning', 'math', 'coding'],
      },
      {
        id: 'o1-mini',
        displayName: 'OpenAI o1 Mini',
        description: 'Smaller reasoning model',
        contextWindow: 128000,
        maxOutputTokens: 65536,
        capabilities: ['reasoning', 'math', 'coding'],
      },
    ];
  }

  isConfigured(): boolean {
    const config = this._config as OpenAIProviderConfig;
    return !!config.apiKey && config.apiKey.length > 0;
  }
}
