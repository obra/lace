// ABOUTME: AWS Bedrock provider for Anthropic Claude models
// ABOUTME: Wraps @anthropic-ai/bedrock-sdk's AnthropicBedrockMantle (Messages API) client

import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  BetaRawMessageStreamEvent,
  BetaRawContentBlockStartEvent,
  BetaRawContentBlockDeltaEvent,
  BetaThinkingDelta,
  BetaMessage,
  BetaTextBlock,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
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
import { getBetasForRequest } from './anthropic/betas';
import {
  buildBetaMessagePayload,
  buildCountTokensParams,
  extractThinkingBlocks,
} from './anthropic/beta-request';

// Betas that Bedrock Mantle rejects even though the Anthropic-direct API
// accepts them. Live-verified against account 526275945504 in us-east-1 on
// 2026-07-23: `cache-diagnosis-2026-04-07` returns 400 "invalid beta flag",
// while `model-context-window-exceeded-2025-08-26` is accepted. Filter the
// rejected ones out of the betas[] we send on the Bedrock path.
// PRI-2900: Bedrock streams carry the same stall exposure as the direct
// Anthropic path — see createStallGuard. Matching values, for the same reason:
// keepalive events make a long silence a genuine dead-connection signal.
export const BEDROCK_STREAM_IDLE_TIMEOUT_MS = 180_000;
const BEDROCK_STREAM_IDLE_POLL_MS = 10_000;

const BEDROCK_UNSUPPORTED_BETAS: ReadonlySet<AnthropicBeta> = new Set<AnthropicBeta>([
  'cache-diagnosis-2026-04-07',
]);

interface BedrockProviderConfig extends ProviderConfig {
  /** AWS region to call Bedrock Mantle in (e.g., "us-east-1"). */
  awsRegion?: string;
  /** Optional static AWS access key; falls back to the default credential chain when absent. */
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsSessionToken?: string;
  observability_betas_enabled?: boolean;
  [key: string]: unknown;
}

export class BedrockProvider extends AIProvider {
  private _bedrock: AnthropicBedrockMantle | null = null;

  constructor(config: BedrockProviderConfig) {
    super(config);
  }

  private getBedrockClient(): AnthropicBedrockMantle {
    if (!this._bedrock) {
      const config = this._config as BedrockProviderConfig;
      const region = config.awsRegion ?? process.env.AWS_REGION;
      if (!region) {
        throw new Error(
          'Missing AWS region for Bedrock provider. Set awsRegion in the provider instance config or the AWS_REGION environment variable.'
        );
      }

      // When explicit credentials are supplied, pass them through. Otherwise the
      // SDK uses the standard AWS credential provider chain (instance metadata,
      // env vars, ~/.aws/credentials).
      if (config.awsAccessKeyId && config.awsSecretAccessKey) {
        this._bedrock = new AnthropicBedrockMantle({
          awsRegion: region,
          awsAccessKey: config.awsAccessKeyId,
          awsSecretAccessKey: config.awsSecretAccessKey,
          awsSessionToken: config.awsSessionToken ?? null,
        });
      } else {
        this._bedrock = new AnthropicBedrockMantle({ awsRegion: region });
      }
    }
    return this._bedrock;
  }

  get providerName(): string {
    return 'bedrock';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  /**
   * Bedrock-flavoured betas[]: the shared observability + per-model catalog
   * betas, minus the ones Bedrock Mantle rejects (see BEDROCK_UNSUPPORTED_BETAS).
   */
  private _bedrockBetas(model: string, opts?: RequestOptions): AnthropicBeta[] {
    const catalogForBetas: CatalogProvider =
      this._catalogData ??
      ({
        name: 'bedrock',
        id: 'bedrock',
        type: 'bedrock',
        default_large_model_id: model,
        default_small_model_id: model,
        models: [],
      } as CatalogProvider);
    const betas = getBetasForRequest(
      catalogForBetas,
      model,
      this._config as BedrockProviderConfig,
      opts?.additionalBetas
        ? { additionalBetas: opts.additionalBetas as AnthropicBeta[] }
        : undefined
    );
    return betas.filter((b) => !BEDROCK_UNSUPPORTED_BETAS.has(b));
  }

  private _createRequestPayload(
    messages: ProviderMessage[],
    tools: WireTool[],
    model: string,
    opts?: RequestOptions
  ): Anthropic.Beta.Messages.MessageCreateParams {
    // Reasoning effort + adaptive thinking, gated on the model supporting
    // effort. A model flagged `has_reasoning_effort: false` receives neither
    // (Bedrock Mantle returns 400 "does not support the effort parameter" for
    // those — live-verified on haiku-4-5, 2026-07-23).
    const catalogModel = this._catalogData?.models.find((m) => m.id === model);
    const reasoningEffort =
      catalogModel?.has_reasoning_effort === false
        ? undefined
        : this.getModelReasoningEffort(model);

    // Structured outputs (output_config.format) and request-level cache
    // diagnostics are omitted: Bedrock Mantle rejects both (live-verified
    // 2026-07-23 — "output_config.format: Extra inputs are not permitted",
    // "invalid beta flag"). We therefore never thread opts.outputFormat here.
    return buildBetaMessagePayload({
      providerName: this.providerName,
      messages,
      systemPrompt: this.getEffectiveSystemPrompt(messages),
      tools,
      model,
      maxTokens: this._config.maxTokens || this.getModelMaxOutputTokens(model, 8192),
      betas: this._bedrockBetas(model, opts),
      reasoningEffort,
      configKeys: Object.keys(this._config),
    });
  }

  // Provider-specific token counting via Bedrock Mantle's beta countTokens.
  protected async _countTokensImpl(
    messages: ProviderMessage[],
    tools: WireTool[] = [],
    model?: string
  ): Promise<number | null> {
    if (!model) {
      return null;
    }
    try {
      const systemPrompt = this.getEffectiveSystemPrompt(messages);
      const result = await this.getBedrockClient().beta.messages.countTokens({
        model,
        ...buildCountTokensParams(messages, systemPrompt, tools),
      });
      return result.input_tokens;
    } catch (error) {
      logger.debug('Token counting failed', { error });
      return null;
    }
  }

  protected async _createResponseImpl(
    messages: ProviderMessage[],
    tools: WireTool[] = [],
    model: string,
    signal?: AbortSignal,
    _conversationState?: { previousResponseId?: string | null },
    options?: RequestOptions
  ): Promise<ProviderResponse> {
    return this.withRetry(
      async () => {
        const requestPayload = this._createRequestPayload(messages, tools, model, options);

        logProviderRequest('bedrock', requestPayload as unknown as Record<string, unknown>);

        let response: BetaMessage;
        try {
          response = (await this.getBedrockClient().beta.messages.create(requestPayload, {
            signal,
          })) as BetaMessage;
        } catch (providerError) {
          const classified = tryClassifyAsContextWindow(providerError, 'BedrockProvider');
          if (classified) return classified;
          throw providerError;
        }

        logProviderResponse('bedrock', response);

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
              cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
              cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
            }
          : undefined;

        logger.debug('Received response from Bedrock', {
          provider: 'bedrock',
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
          'bedrock'
        );

        return {
          content: textContent,
          toolCalls,
          thinkingBlocks: extractThinkingBlocks(response.content),
          stopReason,
          stopDetails,
          usage: normalizedUsage,
          responseId: response.id,
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
    _conversationState?: { previousResponseId?: string | null },
    options?: RequestOptions
  ): Promise<ProviderResponse> {
    let streamingStarted = false;
    let streamCreated = false;

    return this.withRetry(
      async () => {
        const requestPayload = this._createRequestPayload(messages, tools, model, options);

        logProviderRequest('bedrock', requestPayload as unknown as Record<string, unknown>, {
          streaming: true,
        });

        // PRI-2900: same stall exposure as the Anthropic streaming path — a
        // connection that dies after headers goes silent rather than erroring.
        // Client first: it throws on missing credentials, and a throw before
        // the try/finally would strand the guard's interval and listener.
        const client = this.getBedrockClient();
        const guard = this.createStallGuard({
          idleMs: BEDROCK_STREAM_IDLE_TIMEOUT_MS,
          pollMs: BEDROCK_STREAM_IDLE_POLL_MS,
          ...(signal ? { signal } : {}),
        });

        const stream = client.beta.messages.stream(requestPayload, {
          signal: guard.signal,
        });
        streamCreated = true;

        let toolCalls: ToolCall[] = [];

        try {
          stream.on('text', (text) => {
            streamingStarted = true;
            this.emit('token', { token: text });
          });

          let estimatedOutputTokens = 0;
          let currentBlockType: string | null = null;

          stream.on('streamEvent', (event: BetaRawMessageStreamEvent) => {
            guard.noteActivity();
            if (event.type === 'message_delta' && event.usage) {
              const usage = event.usage;
              this.emit('token_usage_update', {
                usage: {
                  promptTokens: usage.input_tokens || 0,
                  completionTokens: usage.output_tokens || 0,
                  totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
                  cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
                  cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
                },
              });
            }

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

          stream.on('text', (text) => {
            const newTokens = this.estimateTokens(text);
            estimatedOutputTokens += newTokens;
            this.emit('token_usage_update', {
              usage: {
                promptTokens: 0,
                completionTokens: estimatedOutputTokens,
                totalTokens: estimatedOutputTokens,
              },
            });
          });

          stream.on('message', (message) => {
            if (message.usage) {
              this.emit('token_usage_update', {
                usage: {
                  promptTokens: message.usage.input_tokens,
                  completionTokens: message.usage.output_tokens,
                  totalTokens: message.usage.input_tokens + message.usage.output_tokens,
                  cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
                  cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
                },
              });
            }
          });

          const finalMessage: BetaMessage = await stream.finalMessage();

          const textContent = (finalMessage.content || [])
            .filter((content): content is BetaTextBlock => content.type === 'text')
            .map((content) => content.text)
            .join('');

          toolCalls = (finalMessage.content || [])
            .filter((content): content is BetaToolUseBlock => content.type === 'tool_use')
            .map((content) => ({
              id: content.id,
              name: content.name,
              arguments: content.input as Record<string, unknown>,
            }));

          logProviderResponse('bedrock', finalMessage, { streaming: true });

          logger.debug('Received streaming response from Bedrock', {
            provider: 'bedrock',
            contentLength: textContent.length,
            toolCallCount: toolCalls.length,
            toolCallNames: toolCalls.map((tc: ToolCall) => tc.name),
            usage: finalMessage.usage,
          });

          const { stopReason, stopDetails } = normalizeAnthropicStop(
            finalMessage.stop_reason,
            finalMessage.stop_details as Parameters<typeof normalizeAnthropicStop>[1],
            finalMessage.stop_sequence,
            'bedrock'
          );

          const response = {
            content: textContent,
            toolCalls,
            thinkingBlocks: extractThinkingBlocks(finalMessage.content),
            stopReason,
            stopDetails,
            usage: finalMessage.usage
              ? {
                  promptTokens: finalMessage.usage.input_tokens,
                  completionTokens: finalMessage.usage.output_tokens,
                  totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
                  cacheCreationInputTokens: finalMessage.usage.cache_creation_input_tokens ?? 0,
                  cacheReadInputTokens: finalMessage.usage.cache_read_input_tokens ?? 0,
                }
              : undefined,
            responseId: finalMessage.id,
          };

          this.emit('complete', { response });

          return response;
        } catch (error) {
          // Run the classifier BEFORE emitting an error log: recoverable
          // context-window 400s shouldn't surface as ERROR-level noise.
          const classified = tryClassifyAsContextWindow(error, 'BedrockProvider (streaming)');
          if (classified) return classified;
          const stalled = this.stallError(guard, BEDROCK_STREAM_IDLE_TIMEOUT_MS, signal);
          if (stalled) {
            logger.error('Streaming error from Bedrock', { error: stalled.message });
            throw stalled;
          }
          const errorObj = error as Error;
          logger.error('Streaming error from Bedrock', { error: errorObj.message });
          throw error;
        } finally {
          guard.dispose();
        }
      },
      {
        signal,
        isStreaming: true,
        canRetry: () => !streamCreated && !streamingStarted,
      }
    );
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: 'bedrock',
      displayName: 'AWS Bedrock (Anthropic)',
      requiresApiKey: false,
      configurationHint:
        'Set awsRegion in the provider instance config. Provide awsAccessKeyId/awsSecretAccessKey for static credentials, or rely on the default AWS credential provider chain.',
    };
  }

  isConfigured(): boolean {
    const config = this._config as BedrockProviderConfig;
    return !!(config.awsRegion ?? process.env.AWS_REGION);
  }

  override isRecoverableError(error: unknown): boolean {
    return super.isRecoverableError(error);
  }
}
