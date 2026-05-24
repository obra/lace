// ABOUTME: Anthropic Claude provider implementation
// ABOUTME: Wraps Anthropic SDK in the common provider interface

import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageStreamEvent,
  RawContentBlockStartEvent,
  RawContentBlockDeltaEvent,
  ThinkingDelta,
} from '@anthropic-ai/sdk/resources/messages';
import { AIProvider, type WireTool } from './base-provider';
import { ProviderMessage, ProviderResponse, ProviderConfig, ProviderInfo } from './base-provider';
import type { CatalogProvider } from './catalog/types';
import { ToolCall } from '@lace/agent/tools/types';
import { logger } from '@lace/agent/utils/logger';
import { logProviderRequest, logProviderResponse } from '@lace/agent/utils/provider-logging';
import { convertToAnthropicFormat } from './format-converters';
import {
  attachMessageCacheBreakpoints,
  buildSystemWithCaching,
  enforceBreakpointBudget,
  markLastToolForCaching,
  type CacheControlOptions,
} from './cache-control';

interface AnthropicProviderConfig extends ProviderConfig {
  apiKey: string | null;
  [key: string]: unknown; // Allow for additional properties
}

// PRI-1806 #4: Anthropic-direct API supports 1h ephemeral cache TTL GA — no
// `anthropic-beta` header required (verified against
// platform.claude.com/docs/en/build-with-claude/prompt-caching on 2026-05-23).
// SDK 0.60 types `ttl: '5m' | '1h'`.
const ANTHROPIC_CACHE_OPTIONS: CacheControlOptions = { ttl: '1h' };

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

  /**
   * Helper method for token counting with explicit control over all parameters.
   * Allows precise counting of individual components (system, tools, messages).
   *
   * PRI-1806 #2: mirrors the wire shape of `_createRequestPayload` — same
   * cache_control breakpoints on system, last tool, and message tail/anchor.
   * Without this, the counted token total drifts from what we actually send
   * (cache_control fields add a small but real overhead, and the array-shaped
   * system block is counted differently than a bare string by countTokens).
   * Callers that use this number for compaction or budget decisions need it
   * to match reality.
   */
  private async countTokensExplicit(
    messages: ProviderMessage[],
    systemPrompt: string,
    tools: WireTool[],
    model: string
  ): Promise<number | null> {
    try {
      const anthropicMessages = convertToAnthropicFormat(messages);
      const messagesWithCaching = attachMessageCacheBreakpoints(
        anthropicMessages,
        ANTHROPIC_CACHE_OPTIONS
      );

      // Omit system entirely when the prompt is blank — Anthropic rejects
      // empty text blocks, and cache_control on an empty block is also invalid.
      const systemWithCaching = systemPrompt.trim()
        ? buildSystemWithCaching(systemPrompt, ANTHROPIC_CACHE_OPTIONS)
        : undefined;

      // Omit tools entirely when none are provided — sending [] or a marked
      // empty array is unnecessary and may trigger API validation errors.
      const baseTools: Anthropic.Tool[] = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));
      const anthropicTools =
        baseTools.length > 0
          ? markLastToolForCaching(baseTools, ANTHROPIC_CACHE_OPTIONS)
          : undefined;

      const result = await this.getAnthropicClient().beta.messages.countTokens({
        model,
        messages: messagesWithCaching,
        ...(systemWithCaching !== undefined ? { system: systemWithCaching } : {}),
        ...(anthropicTools !== undefined ? { tools: anthropicTools } : {}),
      });

      return result.input_tokens;
    } catch (error) {
      logger.debug('Token counting failed', { error });
      return null;
    }
  }

  // Provider-specific token counting using Anthropic's beta API
  protected async _countTokensImpl(
    messages: ProviderMessage[],
    tools: WireTool[] = [],
    model?: string
  ): Promise<number | null> {
    if (!model) {
      return null; // Can't count without model
    }

    const systemPrompt = this.getEffectiveSystemPrompt(messages);
    return this.countTokensExplicit(messages, systemPrompt, tools, model);
  }

  get providerName(): string {
    return 'anthropic';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  private _createRequestPayload(
    messages: ProviderMessage[],
    tools: WireTool[],
    model: string
  ): Anthropic.Messages.MessageCreateParams {
    const anthropicMessages = convertToAnthropicFormat(messages);

    // PRI-1799/1802/1805: attach a rolling-tail + stable-anchor pair of
    // cache_control breakpoints on the message stream so the conversation
    // prefix stays cached across idle gaps and survives Anthropic's
    // 20-raw-block lookback window even on heavy tool-use turns.
    const messagesWithCaching = attachMessageCacheBreakpoints(
      anthropicMessages,
      ANTHROPIC_CACHE_OPTIONS
    );

    const systemPrompt = this.getEffectiveSystemPrompt(messages);
    const systemWithCaching = buildSystemWithCaching(systemPrompt, ANTHROPIC_CACHE_OPTIONS);

    const baseTools: Anthropic.Tool[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
    const anthropicTools = markLastToolForCaching(baseTools, ANTHROPIC_CACHE_OPTIONS);

    // PRI-1806 #1: defensive cap at Anthropic's 4-marker hard limit. With
    // current placement (system + last-tool + anchor + tail) we're at 4
    // exactly; this enforces it if anything upstream stamps additional
    // markers.
    const cappedMessages = enforceBreakpointBudget({
      system: systemWithCaching,
      tools: anthropicTools,
      messages: messagesWithCaching,
    });

    const payload = {
      model,
      max_tokens: this._config.maxTokens || this.getModelMaxOutputTokens(model, 8192),
      messages: cappedMessages,
      system: systemWithCaching,
      tools: anthropicTools,
    };

    // Comprehensive debug logging of request metadata (excluding message content)
    const systemText = Array.isArray(payload.system)
      ? payload.system.map((block) => block.text).join('')
      : (payload.system as string | undefined);
    logger.info('🔍 ANTHROPIC REQUEST METADATA', {
      model: payload.model,
      maxTokens: payload.max_tokens,
      messageCount: payload.messages.length,
      systemPromptLength: systemText?.length || 0,
      systemPromptPreview: systemText?.substring(0, 100) + '...',
      toolCount: payload.tools?.length || 0,
      toolNames: payload.tools?.map((t) => t.name),
      configKeys: Object.keys(this._config),
      providerName: this.providerName,
    });

    return payload;
  }

  protected async _createResponseImpl(
    messages: ProviderMessage[],
    tools: WireTool[] = [],
    model: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    return this.withRetry(
      async () => {
        const requestPayload = this._createRequestPayload(messages, tools, model);

        // Log request with pretty formatting
        logProviderRequest('anthropic', requestPayload as unknown as Record<string, unknown>);

        const extraHeaders = this.getExtraHeadersForModel(model);
        const response = (await this.getAnthropicClient().messages.create(requestPayload, {
          signal,
          ...(extraHeaders ? { headers: extraHeaders } : {}),
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

  protected async _createStreamingResponseImpl(
    messages: ProviderMessage[],
    tools: WireTool[] = [],
    model: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    let streamingStarted = false;

    return this.withRetry(
      async () => {
        const requestPayload = this._createRequestPayload(messages, tools, model);

        // Log streaming request with pretty formatting
        logProviderRequest('anthropic', requestPayload as unknown as Record<string, unknown>, {
          streaming: true,
        });

        // Use the streaming API
        const extraHeaders = this.getExtraHeadersForModel(model);
        const stream = this.getAnthropicClient().messages.stream(requestPayload, {
          signal,
          ...(extraHeaders ? { headers: extraHeaders } : {}),
        });

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

          // Track current block type for thinking event emission
          let currentBlockType: string | null = null;

          // Listen for progressive token usage updates and thinking blocks during streaming
          stream.on('streamEvent', (event: MessageStreamEvent) => {
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

            // Handle thinking block events
            if (event.type === 'content_block_start') {
              const startEvent = event as RawContentBlockStartEvent;
              currentBlockType = startEvent.content_block.type;
              if (currentBlockType === 'thinking') {
                this.emit('thinking_start', {});
              }
            }

            if (event.type === 'content_block_delta') {
              const deltaEvent = event as RawContentBlockDeltaEvent;
              if (deltaEvent.delta.type === 'thinking_delta') {
                const thinkingDelta = deltaEvent.delta as ThinkingDelta;
                this.emit('thinking_delta', { text: thinkingDelta.thinking });
              }
            }

            if (event.type === 'content_block_stop') {
              if (currentBlockType === 'thinking') {
                this.emit('thinking_end', {});
              }
              currentBlockType = null;
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
        canRetry: () => !streamingStarted,
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

  override isRecoverableError(error: unknown): boolean {
    // Use base class implementation - Anthropic SDK uses same patterns as OpenAI
    return super.isRecoverableError(error);
  }

  override isRetryableError(error: unknown): boolean {
    if (super.isRetryableError(error)) {
      return true;
    }
    // The Anthropic SDK sometimes throws a plain Error whose message is the raw
    // SSE event JSON when it encounters an error event mid-stream (e.g. after HTTP
    // 200 has already been received). In that case there is no .status field, so
    // the base-class HTTP-status check misses it. Parse the message and check the
    // Anthropic error type explicitly.
    if (error instanceof Error) {
      return this.isRetryableAnthropicErrorType(error.message);
    }
    return false;
  }

  private isRetryableAnthropicErrorType(message: string): boolean {
    try {
      const parsed: unknown = JSON.parse(message);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'error' in parsed &&
        (parsed as { error?: unknown }).error !== null &&
        typeof (parsed as { error?: unknown }).error === 'object'
      ) {
        const type = (parsed as { error: { type?: unknown } }).error.type;
        // overloaded_error: explicit Anthropic guidance — back off and retry (HTTP 529)
        // api_error: Anthropic's generic transient server-side error — retryable
        return type === 'overloaded_error' || type === 'api_error';
      }
    } catch {
      // Not JSON — not an Anthropic SSE error envelope
    }
    return false;
  }

  // Per-model headers from the catalog (e.g. anthropic-beta to opt into the 1M
  // context window for opus-4-7-1m). Returned undefined when the model has no
  // declared extra headers so callers can spread without sending {} on the wire.
  private getExtraHeadersForModel(model: string): Record<string, string> | undefined {
    const catalogProvider = (this._config as { catalogProvider?: CatalogProvider }).catalogProvider;
    if (!catalogProvider) return undefined;
    const entry = catalogProvider.models.find((m) => m.id === model);
    const headers = entry?.extra_headers;
    if (!headers || Object.keys(headers).length === 0) return undefined;
    return headers;
  }
}
