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
import { AIProvider } from './base-provider';
import { ProviderMessage, ProviderResponse, ProviderConfig, ProviderInfo } from './base-provider';
import { ToolCall } from '@lace/core/tools/types';
import { Tool } from '@lace/core/tools/tool';
import { logger } from '@lace/core/utils/logger';
import { logProviderRequest, logProviderResponse } from '@lace/core/utils/provider-logging';
import { convertToOpenAIFormat } from './format-converters';

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
  private async _loadTiktokenWithEmbeddedWasm(): Promise<typeof import('tiktoken')> {
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
      logger.debug('[OpenAIProvider] No embedded WASM, attempting regular tiktoken import');
      try {
        // Use dynamic import for ESM compatibility (web server)
        this._tiktokenModule = await import('tiktoken');
        logger.debug('[OpenAIProvider] Tiktoken loaded successfully via import()');
        return this._tiktokenModule;
      } catch (importError) {
        logger.error('[OpenAIProvider] Failed to import tiktoken', {
          error: importError,
          errorMessage: importError instanceof Error ? importError.message : String(importError),
          errorStack: importError instanceof Error ? importError.stack : undefined,
        });
        throw importError; // Re-throw to be caught by outer try-catch
      }
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

  /**
   * Helper method for token counting with explicit control over system prompt and tools
   * Allows precise counting of individual components
   */
  private async countTokensExplicit(
    messages: ProviderMessage[],
    systemPrompt: string,
    tools: Tool[],
    model: string
  ): Promise<number | null> {
    try {
      // Get or create cached encoder for this model
      let encoding: Tiktoken;
      if (this._encoderCache.has(model)) {
        encoding = this._encoderCache.get(model)!;
      } else {
        // Check if tiktoken is available (cached result)
        if (this._tiktokenAvailable === false) {
          // Previously failed to load, don't retry
          return null; // Return null to indicate unavailable
        }

        // Load tiktoken with embedded WASM support for bun compile
        let tiktoken: typeof import('tiktoken');
        try {
          tiktoken = await this._loadTiktokenWithEmbeddedWasm();
          // Mark as available on successful load
          this._tiktokenAvailable = true;
        } catch (importError) {
          // WASM loading failed - tiktoken unavailable
          this._tiktokenAvailable = false;
          logger.debug('Tiktoken WASM failed to load, token counting disabled', {
            error: importError,
          });
          return null; // Return null to indicate unavailable (not 0)
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

      // Start with system prompt
      let messageText = systemPrompt ? `system: ${systemPrompt}\n` : '';

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
      return null; // Return null when tiktoken fails entirely
    }
  }

  // Provider-specific token counting using tiktoken for OpenAI-compatible models
  // Returns null when tiktoken WASM fails to load
  async countTokens(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    model?: string
  ): Promise<number | null> {
    if (!model) {
      return null; // Can't count without model
    }

    const systemPrompt = this.getEffectiveSystemPrompt(messages);
    return this.countTokensExplicit(messages, systemPrompt, tools, model);
  }

  /**
   * Parses OpenAI tool call and maps sanitized name back to original
   * Shared by both streaming and non-streaming responses
   */
  private parseToolCall(
    toolCall: { id: string; function: { name: string; arguments: string } },
    toolNameMapping: Map<string, string>
  ): ToolCall {
    const originalName = toolNameMapping.get(toolCall.function.name) || toolCall.function.name;

    try {
      return {
        id: toolCall.id,
        name: originalName,
        arguments: JSON.parse(toolCall.function.arguments) as Record<string, unknown>,
      };
    } catch (error) {
      logger.error('Failed to parse tool call arguments', {
        toolCallId: toolCall.id,
        toolName: originalName,
        sanitizedName: toolCall.function.name,
        arguments: toolCall.function.arguments,
        error: (error as Error).message,
      });
      throw new Error(
        `Invalid JSON in tool call arguments for ${originalName}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Checks if an error is due to streaming requiring organization verification
   * OpenAI returns: type='invalid_request_error', code='unsupported_value', param='stream'
   */
  private isStreamingVerificationError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const errorObj = error as {
      type?: string;
      code?: string;
      param?: string;
    };

    return (
      errorObj.type === 'invalid_request_error' &&
      errorObj.code === 'unsupported_value' &&
      errorObj.param === 'stream'
    );
  }

  /**
   * Calibrates token costs for system prompt and individual tools
   * Uses tiktoken for precise local counting
   */
  async calibrateTokenCosts(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string
  ): Promise<{
    systemTokens: number;
    toolTokens: number;
    toolDetails: Array<{ name: string; tokens: number }>;
  } | null> {
    try {
      const systemPrompt = this.getEffectiveSystemPrompt(messages);

      logger.debug('[OpenAIProvider] Starting calibration', {
        model,
        systemPromptLength: systemPrompt.length,
        toolCount: tools.length,
        tiktokenAvailable: this._tiktokenAvailable,
      });

      // Count system prompt only (no messages, no tools)
      const systemTokensResult = await this.countTokensExplicit([], systemPrompt, [], model);

      logger.debug('[OpenAIProvider] System token count result', {
        systemTokensResult,
        isNull: systemTokensResult === null,
        isZero: systemTokensResult === 0,
      });

      // If countTokensExplicit returns null, tiktoken failed - abort calibration
      if (systemTokensResult === null) {
        logger.warn('[OpenAIProvider] Tiktoken unavailable or failed, cannot calibrate', {
          model,
          tiktokenAvailable: this._tiktokenAvailable,
        });
        return null;
      }

      const systemTokens = systemTokensResult;

      logger.debug('[OpenAIProvider] System prompt counted', { systemTokens });

      // Count each tool individually (no system, no messages)
      const toolDetails = await Promise.all(
        tools.map(async (tool) => ({
          name: tool.name,
          tokens: (await this.countTokensExplicit([], '', [tool], model)) || 0,
        }))
      );

      const toolTokens = toolDetails.reduce((sum, t) => sum + t.tokens, 0);

      logger.debug('[OpenAIProvider] Tools counted', {
        toolTokens,
        toolCount: toolDetails.length,
        sampleTools: toolDetails.slice(0, 3),
      });

      return {
        systemTokens,
        toolTokens,
        toolDetails,
      };
    } catch (error) {
      logger.error('[OpenAIProvider] Calibration failed with exception', { error });
      return null;
    }
  }

  private static readonly MAX_TOOL_NAME_LENGTH = 64;
  private static readonly COLLISION_SUFFIX_RESERVE = 4;

  /**
   * Builds OpenAI tools with sanitized names and returns mapping
   * Request-scoped to prevent concurrent request interference
   * Enforces OpenAI's 64-character limit on tool names
   */
  private buildToolsWithMapping(tools: Tool[]): {
    openaiTools: OpenAI.Chat.ChatCompletionTool[];
    mapping: Map<string, string>;
  } {
    const mapping = new Map<string, string>();
    const openaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((tool) => {
      const sanitized = tool.name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_'); // Collapse consecutive underscores

      // Validate tool name is not empty or underscore-only after sanitization
      if (!sanitized || /^_+$/.test(sanitized)) {
        throw new Error(
          `Tool name "${tool.name}" is invalid - sanitizes to empty or underscore-only string`
        );
      }

      // Reserve space for potential collision suffix
      const maxBaseLength =
        OpenAIProvider.MAX_TOOL_NAME_LENGTH - OpenAIProvider.COLLISION_SUFFIX_RESERVE;

      // Truncate base name if needed to leave room for suffix
      let baseName = sanitized;
      if (baseName.length > maxBaseLength) {
        baseName = baseName.substring(0, maxBaseLength);
      }

      // Check if sanitized name is already used (handles both collisions and duplicates)
      let sanitizedName = baseName;

      if (mapping.has(sanitizedName)) {
        // Name already used - append suffix to make unique
        let suffix = 2;
        sanitizedName = `${baseName}_${suffix}`;

        // Ensure final name doesn't exceed 64 chars and is unique
        while (
          mapping.has(sanitizedName) ||
          sanitizedName.length > OpenAIProvider.MAX_TOOL_NAME_LENGTH
        ) {
          suffix++;
          sanitizedName = `${baseName}_${suffix}`;

          // If suffix grows too large, truncate base name further
          if (sanitizedName.length > OpenAIProvider.MAX_TOOL_NAME_LENGTH) {
            const suffixStr = `_${suffix}`;
            baseName = baseName.substring(
              0,
              OpenAIProvider.MAX_TOOL_NAME_LENGTH - suffixStr.length
            );
            sanitizedName = `${baseName}${suffixStr}`;
          }
        }
      }

      // Final length check (should never exceed, but defensive)
      if (sanitizedName.length > OpenAIProvider.MAX_TOOL_NAME_LENGTH) {
        sanitizedName = sanitizedName.substring(0, OpenAIProvider.MAX_TOOL_NAME_LENGTH);
      }

      mapping.set(sanitizedName, tool.name);

      return {
        type: 'function' as const,
        function: {
          name: sanitizedName,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      };
    });

    return { openaiTools, mapping };
  }

  private _createRequestPayload(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
    stream: boolean
  ): {
    payload: OpenAI.Chat.ChatCompletionCreateParams;
    toolNameMapping: Map<string, string>;
  } {
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

    // Build tools with sanitized names and get mapping (request-scoped)
    const { openaiTools, mapping } = this.buildToolsWithMapping(tools);

    const requestPayload: OpenAI.Chat.ChatCompletionCreateParams = {
      model,
      messages: messagesWithSystem,
      max_completion_tokens: this._config.maxTokens || 4000,
      stream,
      ...(tools.length > 0 && { tools: openaiTools }),
    };

    return { payload: requestPayload, toolNameMapping: mapping };
  }

  async createResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    model: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    return this.withRetry(
      async () => {
        const { payload: requestPayload, toolNameMapping } = this._createRequestPayload(
          messages,
          tools,
          model,
          false
        );

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
          choice.message.tool_calls?.map((toolCall: OpenAI.Chat.ChatCompletionMessageToolCall) =>
            this.parseToolCall(toolCall, toolNameMapping)
          ) || [];

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

          const countedTokens = await this.countTokens(messages, tools, model);
          const estimatedPromptTokens =
            countedTokens ?? this.estimateTokens(promptText + toolsText);
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
        const { payload: requestPayload, toolNameMapping } = this._createRequestPayload(
          messages,
          tools,
          model,
          true
        );

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
          toolCalls = Array.from(partialToolCalls.values()).map((partial) =>
            this.parseToolCall(
              {
                id: partial.id,
                function: { name: partial.name, arguments: partial.arguments },
              },
              toolNameMapping
            )
          );

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

            const countedTokens = await this.countTokens(messages, tools, model);
            const estimatedPromptTokens =
              countedTokens ?? this.estimateTokens(promptText + toolsText);
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

          // Check if this is a streaming verification error
          if (this.isStreamingVerificationError(error)) {
            logger.warn(
              'OpenAI streaming requires organization verification, falling back to non-streaming mode',
              { model }
            );
            // Fall back to non-streaming mode
            return this.createResponse(messages, tools, model, signal);
          }

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

  override isRecoverableError(error: unknown): boolean {
    // Safely narrow unknown to non-null object
    if (!error || typeof error !== 'object' || error === null) {
      return false;
    }

    // Cast to safe interface for property access
    const errorObj = error as {
      status?: number;
      statusCode?: number;
      type?: string;
      code?: string;
      constructor?: { name?: string };
      error?: {
        type?: string;
        code?: string;
        status_code?: number;
      };
    };

    // OpenAI SDK throws BadRequestError for 400 status codes
    if (errorObj.constructor?.name === 'BadRequestError') {
      return true;
    }

    // Check for 400 status code (handle both status and statusCode fields)
    const status = errorObj.status ?? errorObj.statusCode ?? errorObj.error?.status_code;
    if (typeof status === 'number' && status === 400) {
      return true;
    }

    // Check for specific OpenAI error types that indicate recoverable tool issues
    if (errorObj.type === 'invalid_request_error' || errorObj.code === 'tool_use_failed') {
      return true;
    }

    // Check nested error structure (some OpenAI errors nest details)
    if (errorObj.error) {
      if (
        errorObj.error.type === 'invalid_request_error' ||
        errorObj.error.code === 'tool_use_failed'
      ) {
        return true;
      }
    }

    return false;
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
