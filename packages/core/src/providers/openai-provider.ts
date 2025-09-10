// ABOUTME: OpenAI GPT provider implementation
// ABOUTME: Wraps OpenAI SDK in the common provider interface

import OpenAI, { ClientOptions } from 'openai';

// Import tiktoken WASM for embedding in bun compile (skip in test environment)
if (process.env.NODE_ENV !== 'test') {
  // Use require with try-catch to avoid breaking test environments that don't support import attributes
  try {
    // This will only work in bun compile, but that's fine
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Required for WASM embedding in bun compile
    require('tiktoken/tiktoken_bg.wasm');
  } catch {
    // Ignore - this is expected in non-bun environments
  }
}

// Dynamic tiktoken import to handle WASM loading failures gracefully
type Tiktoken = import('tiktoken').Tiktoken;
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
import { convertToOpenAIFormat } from '~/providers/format-converters';

interface OpenAIProviderConfig extends ProviderConfig {
  apiKey: string | null;
  [key: string]: unknown; // Allow for additional properties
}

export class OpenAIProvider extends AIProvider {
  private _openai: OpenAI | null = null;
  private _encoderCache = new Map<string, Tiktoken>();
  private _tiktokenModule: typeof import('tiktoken') | null = null;
  private _tiktokenAvailable: boolean | undefined = undefined;

  constructor(config: OpenAIProviderConfig) {
    super(config);
  }

  private getOpenAIClient(): OpenAI {
    if (!this._openai) {
      const config = this._config as OpenAIProviderConfig;
      const configBaseURL = config.baseURL as string | undefined;

      // Allow no API key for local OpenAI-compatible endpoints
      if (!config.apiKey && !configBaseURL) {
        throw new Error(
          'Missing API key for OpenAI provider. Please ensure the provider instance has valid credentials.'
        );
      }

      if (!config.apiKey && configBaseURL) {
        logger.info('Using OpenAI-compatible endpoint without API key', {
          baseURL: configBaseURL,
        });
      }

      const openaiConfig: ClientOptions = {
        apiKey: config.apiKey || 'not-required-for-local',
        dangerouslyAllowBrowser: process.env.NODE_ENV === 'test',
      };

      // Support custom base URL for OpenAI-compatible APIs
      if (configBaseURL) {
        openaiConfig.baseURL = configBaseURL;
        logger.info('Using custom OpenAI base URL', {
          baseURL: configBaseURL,
        });
      }

      this._openai = new OpenAI(openaiConfig);
    }
    return this._openai;
  }

  get providerName(): string {
    return 'openai';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  /**
   * Loads tiktoken with embedded WASM support for bun compile
   * Uses scoped fs patching - only active during import, then fully restored
   */
  private _loadTiktokenWithEmbeddedWasm(): typeof import('tiktoken') {
    // Return cached module if already loaded
    if (this._tiktokenModule) {
      return this._tiktokenModule;
    }

    // Check if we have embedded WASM available
    let wasmBuffer: Buffer | null = null;
    if (typeof globalThis.Bun !== 'undefined') {
      const bunGlobal = globalThis.Bun as unknown;
      if (
        bunGlobal &&
        typeof bunGlobal === 'object' &&
        'embeddedFiles' in bunGlobal &&
        Array.isArray((bunGlobal as { embeddedFiles: unknown }).embeddedFiles)
      ) {
        const embeddedFiles = (
          bunGlobal as { embeddedFiles: Array<{ name: string; arrayBuffer(): ArrayBuffer }> }
        ).embeddedFiles;
        const wasmFile = embeddedFiles.find((file) => file.name === 'tiktoken_bg.wasm');
        if (wasmFile) {
          // This is sync in the compiled context since embeddedFiles are pre-extracted
          wasmBuffer = Buffer.from(wasmFile.arrayBuffer());
        }
      }
    }

    // If no embedded WASM, fall back to regular import
    if (!wasmBuffer) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Fallback for non-embedded environments
      this._tiktokenModule = require('tiktoken') as typeof import('tiktoken');
      return this._tiktokenModule;
    }

    // Use scoped fs patching for embedded WASM
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Required for fs patching
    const fs = require('fs') as typeof import('fs');
    const originalReadFileSync = fs.readFileSync;

    // Patch fs only during tiktoken import
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for fs patching with dynamic types
    const patchedReadFileSync = function (this: any, path: any, options?: any) {
      if (typeof path === 'string' && path.includes('tiktoken_bg.wasm')) {
        return wasmBuffer;
      }
      return originalReadFileSync.call(this, path, options);
    };
    fs.readFileSync = patchedReadFileSync as typeof fs.readFileSync;

    try {
      // Import tiktoken while patch is active
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Required for scoped patching
      this._tiktokenModule = require('tiktoken') as typeof import('tiktoken');
      return this._tiktokenModule;
    } finally {
      // Always restore original fs.readFileSync
      fs.readFileSync = originalReadFileSync;
    }
  }

  // Provider-specific token counting using tiktoken for OpenAI-compatible models
  // Returns 0 when tiktoken WASM fails to load, allowing graceful degradation
  countTokens(messages: ProviderMessage[], tools: Tool[] = [], model?: string): number | null {
    if (!model) {
      return null; // Can't count without model
    }

    try {
      // Get or create cached encoder for this model
      let encoding: Tiktoken;
      if (this._encoderCache.has(model)) {
        encoding = this._encoderCache.get(model)!;
      } else {
        // Check if tiktoken is available (cached result)
        if (this._tiktokenAvailable === false) {
          // Previously failed to load, don't retry
          return 0;
        }

        // Load tiktoken with embedded WASM support for bun compile
        let tiktoken: typeof import('tiktoken');
        try {
          tiktoken = this._loadTiktokenWithEmbeddedWasm();
          // Mark as available on successful load
          this._tiktokenAvailable = true;
        } catch (importError) {
          // WASM loading failed - tiktoken unavailable
          this._tiktokenAvailable = false;
          logger.debug('Tiktoken WASM failed to load, token counting disabled', {
            error: importError,
          });
          return 0;
        }

        try {
          encoding = tiktoken.encoding_for_model(
            model as Parameters<typeof tiktoken.encoding_for_model>[0]
          );
        } catch (error) {
          // Fallback for unknown/custom/OpenAI-compatible models
          logger.debug(`Model ${model} not recognized by tiktoken, using default encoding`, {
            error,
          });
          encoding = tiktoken.get_encoding('cl100k_base'); // Default for most OpenAI-compatible models
        }
        this._encoderCache.set(model, encoding);
      }

      // Add system prompt
      const systemPrompt = this.getEffectiveSystemPrompt(messages);
      let messageText = `system: ${systemPrompt}\n`;

      // Convert messages to text for token counting, excluding system messages to avoid double-counting
      for (const message of messages) {
        if (message.role !== 'system') {
          messageText += `${message.role}: ${message.content}\n`;
        }
      }

      // Count base message tokens
      let totalTokens = encoding.encode(messageText).length;

      // Add tool schema tokens if tools are provided
      if (tools.length > 0) {
        const toolsText = JSON.stringify(
          tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          }))
        );
        totalTokens += encoding.encode(toolsText).length;
        totalTokens += tools.length * 3; // Overhead per tool
      }

      // Add conversation overhead (conservative estimate)
      totalTokens += 10;

      return totalTokens;
    } catch (error) {
      logger.debug('Token counting failed, gracefully degrading', { error });
      return 0; // Return 0 when tiktoken fails entirely
    }
  }

  private _createRequestPayload(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
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
      model,
      messages: messagesWithSystem,
      max_completion_tokens: this._config.maxTokens || 4000,
      stream,
      ...(tools.length > 0 && { tools: openaiTools }),
    };

    return requestPayload;
  }

  async createResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    model: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    return this.withRetry(
      async () => {
        const requestPayload = this._createRequestPayload(messages, tools, model, false);

        // Log request with pretty formatting
        logProviderRequest('openai', requestPayload as unknown as Record<string, unknown>);

        const response = (await this.getOpenAIClient().chat.completions.create(requestPayload, {
          signal,
        })) as OpenAI.Chat.ChatCompletion;

        // Log response with pretty formatting
        logProviderResponse('openai', response);

        const choice = response.choices[0];
        if (!choice.message) {
          throw new Error('No message in OpenAI response');
        }

        const textContent = choice.message.content || '';

        const toolCalls: ToolCall[] =
          choice.message.tool_calls?.map((toolCall: OpenAI.Chat.ChatCompletionMessageToolCall) => {
            try {
              return {
                id: toolCall.id,
                name: toolCall.function.name,
                arguments: JSON.parse(toolCall.function.arguments) as Record<string, unknown>,
              };
            } catch (error) {
              logger.error('Failed to parse tool call arguments', {
                toolCallId: toolCall.id,
                toolName: toolCall.function.name,
                arguments: toolCall.function.arguments,
                error: (error as Error).message,
              });
              throw new Error(
                `Invalid JSON in tool call arguments for ${toolCall.function.name}: ${(error as Error).message}`
              );
            }
          }) || [];

        logger.debug('Received response from OpenAI', {
          provider: 'openai',
          contentLength: textContent.length,
          toolCallCount: toolCalls.length,
          toolCallNames: toolCalls.map((tc) => tc.name),
          usage: response.usage,
        });

        // Extract usage data from response, or estimate if missing (for OpenAI-compatible endpoints)
        let usage: ProviderResponse['usage'];
        if (response.usage) {
          usage = {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          };
        } else {
          // Fallback: estimate tokens when OpenAI-compatible endpoints don't provide usage
          logger.debug('No usage data in OpenAI response, estimating tokens', {
            provider: 'openai',
            model: requestPayload.model,
          });

          // Include system prompt and tool context for accurate estimation
          const systemPrompt = this.getEffectiveSystemPrompt(messages);
          const promptText = systemPrompt + '\n' + messages.map((m) => m.content).join(' ');
          const toolsText = tools.length > 0 ? JSON.stringify(tools) : '';

          const estimatedPromptTokens =
            this.countTokens(messages, tools, model) ?? this.estimateTokens(promptText + toolsText);
          const estimatedCompletionTokens = this.estimateTokens(textContent);

          usage = {
            promptTokens: estimatedPromptTokens,
            completionTokens: estimatedCompletionTokens,
            totalTokens: estimatedPromptTokens + estimatedCompletionTokens,
          };
        }

        return {
          content: textContent,
          toolCalls,
          stopReason: this.normalizeStopReason(choice.finish_reason),
          usage,
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
        const requestPayload = this._createRequestPayload(messages, tools, model, true);

        // Log streaming request with pretty formatting
        logProviderRequest('openai', requestPayload as unknown as Record<string, unknown>, {
          streaming: true,
        });

        try {
          // Use the streaming API
          const stream = (await this.getOpenAIClient().chat.completions.create(requestPayload, {
            signal,
          })) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;

          // Mark that stream is created to prevent retries after this point
          streamCreated = true;

          let content = '';
          let toolCalls: ToolCall[] = [];
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
          toolCalls = Array.from(partialToolCalls.values()).map((partial) => {
            try {
              return {
                id: partial.id,
                name: partial.name,
                arguments: JSON.parse(partial.arguments) as Record<string, unknown>,
              };
            } catch (error) {
              logger.error('Failed to parse streaming tool call arguments', {
                toolCallId: partial.id,
                toolName: partial.name,
                arguments: partial.arguments,
                error: (error as Error).message,
              });
              throw new Error(
                `Invalid JSON in streaming tool call arguments for ${partial.name}: ${(error as Error).message}`
              );
            }
          });

          logger.debug('Received streaming response from OpenAI', {
            provider: 'openai',
            contentLength: content.length,
            toolCallCount: toolCalls.length,
            toolCallNames: toolCalls.map((tc) => tc.name),
            usage,
          });

          // Extract usage data from stream, or estimate if missing (for OpenAI-compatible endpoints)
          let finalUsage: ProviderResponse['usage'];
          if (
            usage &&
            typeof usage.prompt_tokens === 'number' &&
            typeof usage.completion_tokens === 'number' &&
            typeof usage.total_tokens === 'number'
          ) {
            finalUsage = {
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens,
              totalTokens: usage.total_tokens,
            };
          } else {
            // Fallback: estimate tokens when OpenAI-compatible endpoints don't provide usage
            logger.debug('No usage data in OpenAI streaming response, estimating tokens', {
              provider: 'openai',
              model: requestPayload.model,
            });

            // Build prompt text same way as non-streaming: system prompt + non-system messages
            const systemPrompt = this.getEffectiveSystemPrompt(messages);
            const nonSystemMessages = messages.filter((m) => m.role !== 'system');
            const promptText =
              systemPrompt + '\n' + nonSystemMessages.map((m) => m.content).join(' ');
            const toolsText = tools.length > 0 ? JSON.stringify(tools) : '';

            // Include tool call arguments in completion token estimation
            let completionText = content;
            for (const partial of partialToolCalls.values()) {
              completionText += partial.arguments;
            }

            const estimatedPromptTokens =
              this.countTokens(messages, tools, model) ??
              this.estimateTokens(promptText + toolsText);
            const estimatedCompletionTokens = this.estimateTokens(completionText);

            finalUsage = {
              promptTokens: estimatedPromptTokens,
              completionTokens: estimatedCompletionTokens,
              totalTokens: estimatedPromptTokens + estimatedCompletionTokens,
            };
          }

          const response = {
            content,
            toolCalls,
            stopReason: this.normalizeStopReason(stopReason),
            usage: finalUsage,
          };

          // Emit completion event
          this.emit('complete', { response });

          return response;
        } catch (error) {
          const errorObj = error as Error;
          logger.error('Streaming error from OpenAI', { error: errorObj.message });
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

  isConfigured(): boolean {
    const config = this._config as OpenAIProviderConfig;
    const configBaseURL = config.baseURL as string | undefined;
    // Configured if we have an API key, or if we have a custom base URL (for local endpoints)
    return (!!config.apiKey && config.apiKey.length > 0) || !!configBaseURL;
  }

  // Clean up encoder cache to prevent memory leaks
  destroy(): void {
    for (const encoder of this._encoderCache.values()) {
      encoder.free();
    }
    this._encoderCache.clear();
    super.removeAllListeners();
  }
}
