// ABOUTME: OpenAI GPT provider implementation
// ABOUTME: Wraps OpenAI SDK in the common provider interface

import OpenAI, { ClientOptions } from 'openai';
import { AIProvider } from './base-provider.js';
import {
  ProviderMessage,
  ProviderResponse,
  ProviderConfig,
  ProviderToolCall,
} from './base-provider.js';
import { Tool } from '../tools/types.js';
import { logger } from '../utils/logger.js';
import { convertToOpenAIFormat } from './format-converters.js';

export interface OpenAIProviderConfig extends ProviderConfig {
  apiKey: string;
  [key: string]: unknown; // Allow for additional properties
}

export class OpenAIProvider extends AIProvider {
  private readonly _openai: OpenAI;

  constructor(config: OpenAIProviderConfig) {
    super(config);

    const openaiConfig: ClientOptions = {
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true, // Allow in test environments
    };

    // Support custom base URL for OpenAI-compatible APIs
    const baseURL = process.env.OPENAI_BASE_URL;
    if (baseURL) {
      openaiConfig.baseURL = baseURL;
      logger.info('Using custom OpenAI base URL', { baseURL });
    }

    this._openai = new OpenAI(openaiConfig);
  }

  get providerName(): string {
    return 'openai';
  }

  get defaultModel(): string {
    return 'gpt-4o-mini';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  get contextWindow(): number {
    const model = this.modelName.toLowerCase();

    // GPT-4o and GPT-4-turbo models
    if (model.includes('gpt-4o') || model.includes('gpt-4-turbo')) {
      return 128000;
    }

    // O1 models
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

    // O1 models have larger output limits
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

    const response = (await this._openai.chat.completions.create(requestPayload, {
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
  }

  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
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
      const stream = (await this._openai.chat.completions.create(requestPayload, {
        signal,
      })) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;

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
            const index = toolCall.index!;

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
      this.emit('error', { error: errorObj });
      throw error;
    }
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
}
