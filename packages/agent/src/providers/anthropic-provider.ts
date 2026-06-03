// ABOUTME: Anthropic Claude provider implementation
// ABOUTME: Wraps Anthropic SDK in the common provider interface

import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaRawMessageStreamEvent,
  BetaRawContentBlockStartEvent,
  BetaRawContentBlockDeltaEvent,
  BetaThinkingDelta,
  BetaMessage,
  BetaTextBlock,
  BetaToolUseBlock,
  BetaMessageParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { BetaCacheMissReason } from './anthropic/cache-miss';
import type { AnthropicBeta } from '@anthropic-ai/sdk/resources/beta/beta';
import { AIProvider, type WireTool } from './base-provider';
import {
  ProviderMessage,
  ProviderResponse,
  ProviderConfig,
  ProviderInfo,
  RequestOptions,
} from './base-provider';
import { normalizeAnthropicStop } from './stop-reason';
import { tryClassifyAsContextWindow } from './utils/error-classifier';
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
import { getBetasForRequest } from './anthropic/betas';

interface AnthropicProviderConfig extends ProviderConfig {
  apiKey: string | null;
  /**
   * Opt out of the global observability betas (cache-diagnosis,
   * model-context-window-exceeded). Default = on. Explicit `false` disables.
   * See `./anthropic/betas.ts` for the full list.
   */
  observability_betas_enabled?: boolean;
  [key: string]: unknown; // Allow for additional properties
}

// Anthropic-direct API supports 1h ephemeral cache TTL GA — no
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
   * Mirrors the wire shape of `_createRequestPayload` — same
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

      const systemWithCaching = buildSystemWithCaching(systemPrompt, ANTHROPIC_CACHE_OPTIONS);

      const baseTools: Anthropic.Tool[] = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));
      const anthropicTools = markLastToolForCaching(baseTools, ANTHROPIC_CACHE_OPTIONS);

      const result = await this.getAnthropicClient().beta.messages.countTokens({
        model,
        messages: messagesWithCaching,
        system: systemWithCaching,
        ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
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

  /**
   * Extract `diagnostics.cache_miss_reason` from a BetaMessage and emit an INFO
   * log when a miss is present. Returns the miss reason (or null) for the
   * caller to attach to the ProviderResponse. The SDK types `diagnostics` as
   * `BetaDiagnostics | null` on BetaMessage and `cache_miss_reason` on
   * BetaDiagnostics as the union (or null for a hit / pending diagnosis).
   *
   * The `context` carries the request's model and the previous-turn response
   * id we compared against, so the INFO log gives the on-call engineer enough
   * to pivot from a Loki line straight to the specific request/response pair
   * in the SDK logs.
   */
  private _extractCacheMissReason(
    message: BetaMessage,
    context: { model: string; previousResponseId: string | null }
  ): BetaCacheMissReason | null {
    const reason = message.diagnostics?.cache_miss_reason ?? null;
    if (reason) {
      logger.info('Anthropic cache miss', {
        type: reason.type,
        missedTokens:
          'cache_missed_input_tokens' in reason ? reason.cache_missed_input_tokens : undefined,
        model: context.model,
        previousResponseId: context.previousResponseId,
        currentResponseId: message.id ?? null,
      });
    }
    return reason;
  }

  private _createRequestPayload(
    messages: ProviderMessage[],
    tools: WireTool[],
    model: string,
    opts?: RequestOptions,
    conversationState?: { previousResponseId?: string | null }
  ): Anthropic.Beta.Messages.MessageCreateParams {
    const anthropicMessages = convertToAnthropicFormat(messages);

    // Attach a rolling-tail + stable-anchor pair of
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

    // Defensive cap at Anthropic's 4-marker hard limit. With
    // current placement (system + last-tool + anchor + tail) we're at 4
    // exactly; this enforces it if anything upstream stamps additional
    // markers.
    const cappedMessages = enforceBreakpointBudget({
      system: systemWithCaching,
      tools: anthropicTools,
      messages: messagesWithCaching,
    });

    // Compute the typed betas[] once, reading per-model entries from the
    // attached catalog plus the per-instance observability flag. If no
    // catalog is attached, parseCatalogBetas returns [] and only the
    // observability betas (default on) ride along.
    const catalogForBetas: CatalogProvider =
      this._catalogData ??
      ({
        name: 'anthropic',
        id: 'anthropic',
        type: 'anthropic',
        default_large_model_id: model,
        default_small_model_id: model,
        models: [],
      } as CatalogProvider);
    const betas = getBetasForRequest(
      catalogForBetas,
      model,
      this._config as AnthropicProviderConfig,
      opts?.additionalBetas
        ? { additionalBetas: opts.additionalBetas as AnthropicBeta[] }
        : undefined
    );

    // Opt into request-level cache diagnostics when the beta is enabled.
    // `previous_message_id: null` opts in for the first turn of a session (no
    // prior response to compare against); subsequent turns thread the prior
    // BetaMessage.id forward via ConversationState.previousResponseId so the
    // server can report cache_miss_reason vs the previous request.
    const cacheDiagEnabled = betas.includes('cache-diagnosis-2026-04-07');
    const diagnosticsField = cacheDiagEnabled
      ? { diagnostics: { previous_message_id: conversationState?.previousResponseId ?? null } }
      : {};

    // Native structured outputs: when the caller constrains the answer to a
    // JSON schema, attach `output_config.format` and the structured-outputs
    // beta. The `.create()`/`.stream()` calls (unlike `.parse()`) do not
    // auto-inject this beta, so we add it explicitly. The schema shape matches
    // BetaJSONOutputFormat exactly (validated upstream at the prompt handler).
    const outputFormat = opts?.outputFormat;
    const effectiveBetas = outputFormat
      ? [...betas, 'structured-outputs-2025-12-15' as AnthropicBeta]
      : betas;
    const outputConfigField = outputFormat ? { output_config: { format: outputFormat } } : {};

    // The beta endpoint param shape is structurally compatible with the
    // base MessageParam (same `role` + `content` fields), but the SDK's
    // declared content-block union differs. Cast at this single boundary
    // rather than widening the format-converter return type, which would
    // ripple into bedrock-provider (no beta namespace on its SDK).
    const payload: Anthropic.Beta.Messages.MessageCreateParams = {
      model,
      max_tokens: this._config.maxTokens || this.getModelMaxOutputTokens(model, 8192),
      messages: cappedMessages as unknown as BetaMessageParam[],
      system: systemWithCaching,
      tools: anthropicTools,
      betas: effectiveBetas,
      ...diagnosticsField,
      ...outputConfigField,
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
      // payload.tools is BetaToolUnion[] in the type system. We only ever
      // construct user-defined `BetaTool`-shaped entries here (which carry a
      // `name`), so guard the union for the logger.
      toolNames: payload.tools?.map((t) => ('name' in t ? t.name : '<server-tool>')),
      configKeys: Object.keys(this._config),
      providerName: this.providerName,
    });

    return payload;
  }

  /**
   * Parse the response text into a structured object when the request set
   * `outputFormat`. Native structured outputs guarantee the text is valid JSON
   * matching the schema; a parse failure means the model didn't honor the
   * contract — we log and return undefined so consumers fail-closed rather than
   * acting on garbage.
   */
  private _extractStructuredOutput(textContent: string, options?: RequestOptions): unknown {
    if (!options?.outputFormat) return undefined;
    try {
      return JSON.parse(textContent);
    } catch (err) {
      logger.warn('Anthropic structured-output response was not valid JSON', {
        provider: this.providerName,
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  protected async _createResponseImpl(
    messages: ProviderMessage[],
    tools: WireTool[] = [],
    model: string,
    signal?: AbortSignal,
    conversationState?: { previousResponseId?: string | null },
    options?: RequestOptions
  ): Promise<ProviderResponse> {
    return this.withRetry(
      async () => {
        const requestPayload = this._createRequestPayload(
          messages,
          tools,
          model,
          options,
          conversationState
        );

        // Log request with pretty formatting
        logProviderRequest('anthropic', requestPayload as unknown as Record<string, unknown>);

        let response: BetaMessage;
        try {
          response = (await this.getAnthropicClient().beta.messages.create(requestPayload, {
            signal,
          })) as BetaMessage;
        } catch (providerError) {
          const classified = tryClassifyAsContextWindow(providerError, 'AnthropicProvider');
          if (classified) return classified;
          throw providerError;
        }

        // Log response with pretty formatting
        logProviderResponse('anthropic', response);

        const textContent = (response.content || [])
          .filter((contentBlock): contentBlock is BetaTextBlock => contentBlock.type === 'text')
          .map((contentBlock) => contentBlock.text)
          .join('');

        const toolCalls: ToolCall[] = (response.content || [])
          .filter(
            (contentBlock): contentBlock is BetaToolUseBlock => contentBlock.type === 'tool_use'
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
              // Surface cache accounting so the runner can compute
              // real cost. Anthropic returns these on every Messages API
              // response — null/missing means zero (no cache activity).
              cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
              cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
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

        const { stopReason, stopDetails } = normalizeAnthropicStop(
          response.stop_reason,
          response.stop_details as Parameters<typeof normalizeAnthropicStop>[1],
          response.stop_sequence,
          'anthropic_direct'
        );

        return {
          content: textContent,
          toolCalls,
          stopReason,
          stopDetails,
          usage: normalizedUsage,
          responseId: response.id,
          cacheMissReason: this._extractCacheMissReason(response, {
            model: requestPayload.model,
            previousResponseId: conversationState?.previousResponseId ?? null,
          }),
          structuredOutput: this._extractStructuredOutput(textContent, options),
        };
      },
      { signal }
    );
  }

  protected async _createStreamingResponseImpl(
    messages: ProviderMessage[],
    tools: WireTool[] = [],
    model: string,
    signal?: AbortSignal,
    conversationState?: { previousResponseId?: string | null },
    options?: RequestOptions
  ): Promise<ProviderResponse> {
    let streamingStarted = false;

    return this.withRetry(
      async () => {
        const requestPayload = this._createRequestPayload(
          messages,
          tools,
          model,
          options,
          conversationState
        );

        // Log streaming request with pretty formatting
        logProviderRequest('anthropic', requestPayload as unknown as Record<string, unknown>, {
          streaming: true,
        });

        const stream = this.getAnthropicClient().beta.messages.stream(requestPayload, {
          signal,
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
          stream.on('streamEvent', (event: BetaRawMessageStreamEvent) => {
            if (event.type === 'message_delta' && event.usage) {
              const usage = event.usage;
              this.emit('token_usage_update', {
                usage: {
                  promptTokens: usage.input_tokens || 0,
                  completionTokens: usage.output_tokens || 0,
                  totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
                  // Progressive cache totals so UI consumers (e.g.
                  // sen-core's bot-debugging channel formatter) can show the
                  // cache breakdown mid-turn without waiting for the final
                  // message.
                  cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
                  cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
                },
              });
            }

            // Handle thinking block events
            if (event.type === 'content_block_start') {
              const startEvent = event as BetaRawContentBlockStartEvent;
              currentBlockType = startEvent.content_block.type;
              if (currentBlockType === 'thinking') {
                this.emit('thinking_start', {});
              }
            }

            if (event.type === 'content_block_delta') {
              const deltaEvent = event as BetaRawContentBlockDeltaEvent;
              if (deltaEvent.delta.type === 'thinking_delta') {
                const thinkingDelta = deltaEvent.delta as BetaThinkingDelta;
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
                  // Final-message cache totals.
                  cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
                  cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
                },
              });
            }
          });

          // Wait for the stream to complete and get the final message
          const finalMessage: BetaMessage = await stream.finalMessage();

          // Extract text content from the final message
          const textContent = (finalMessage.content || [])
            .filter((content): content is BetaTextBlock => content.type === 'text')
            .map((content) => content.text)
            .join('');

          // Extract tool calls from the final message
          toolCalls = (finalMessage.content || [])
            .filter((content): content is BetaToolUseBlock => content.type === 'tool_use')
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

          const { stopReason, stopDetails } = normalizeAnthropicStop(
            finalMessage.stop_reason,
            finalMessage.stop_details as Parameters<typeof normalizeAnthropicStop>[1],
            finalMessage.stop_sequence,
            'anthropic_direct'
          );

          const response = {
            content: textContent,
            toolCalls,
            stopReason,
            stopDetails,
            usage: finalMessage.usage
              ? {
                  promptTokens: finalMessage.usage.input_tokens,
                  completionTokens: finalMessage.usage.output_tokens,
                  totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
                  // See non-streaming branch above for cache totals.
                  cacheCreationInputTokens: finalMessage.usage.cache_creation_input_tokens ?? 0,
                  cacheReadInputTokens: finalMessage.usage.cache_read_input_tokens ?? 0,
                }
              : undefined,
            responseId: finalMessage.id,
            cacheMissReason: this._extractCacheMissReason(finalMessage, {
              model: requestPayload.model,
              previousResponseId: conversationState?.previousResponseId ?? null,
            }),
            structuredOutput: this._extractStructuredOutput(textContent, options),
          };

          // Emit completion event
          this.emit('complete', { response });

          return response;
        } catch (error) {
          // Run the classifier BEFORE emitting an error log: recoverable
          // context-window 400s shouldn't surface as ERROR-level noise.
          const classified = tryClassifyAsContextWindow(error, 'AnthropicProvider (streaming)');
          if (classified) return classified;
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

  // Note: Anthropic-direct no longer needs per-model HTTP headers. Per-model
  // beta opt-ins flow through the typed betas[] array on each request — see
  // `./anthropic/betas.ts`. Bedrock keeps its own header-based opt-in path
  // (the bedrock SDK does not expose a beta namespace).
}
