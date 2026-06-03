// ABOUTME: AWS Bedrock provider for Anthropic Claude models
// ABOUTME: Wraps @anthropic-ai/bedrock-sdk in the common provider interface

import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  MessageStreamEvent,
  RawContentBlockStartEvent,
  RawContentBlockDeltaEvent,
  ThinkingDelta,
} from '@anthropic-ai/sdk/resources/messages';
import { AIProvider, type WireTool } from './base-provider';
import { ProviderMessage, ProviderResponse, ProviderConfig, ProviderInfo } from './base-provider';
import { normalizeAnthropicStop } from './stop-reason';
import { tryClassifyAsContextWindow } from './utils/error-classifier';
import { ToolCall } from '@lace/agent/tools/types';
import { logger } from '@lace/agent/utils/logger';
import { logProviderRequest, logProviderResponse } from '@lace/agent/utils/provider-logging';
import { convertToAnthropicFormat } from './format-converters';
import {
  attachMessageCacheBreakpoints,
  bedrockCacheTtlFor,
  buildSystemWithCaching,
  enforceBreakpointBudget,
  markLastToolForCaching,
  type CacheControlOptions,
} from './cache-control';

interface BedrockProviderConfig extends ProviderConfig {
  /** AWS region to call Bedrock in (e.g., "us-west-1"). */
  awsRegion?: string;
  /** Optional static AWS access key; falls back to the default credential chain when absent. */
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsSessionToken?: string;
  [key: string]: unknown;
}

export class BedrockProvider extends AIProvider {
  private _bedrock: AnthropicBedrock | null = null;

  constructor(config: BedrockProviderConfig) {
    super(config);
  }

  private getBedrockClient(): AnthropicBedrock {
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
        this._bedrock = new AnthropicBedrock({
          awsRegion: region,
          awsAccessKey: config.awsAccessKeyId,
          awsSecretKey: config.awsSecretAccessKey,
          awsSessionToken: config.awsSessionToken ?? null,
        });
      } else {
        this._bedrock = new AnthropicBedrock({ awsRegion: region });
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

  private _createRequestPayload(
    messages: ProviderMessage[],
    tools: WireTool[],
    model: string
  ): Anthropic.Messages.MessageCreateParams {
    const anthropicMessages = convertToAnthropicFormat(messages);
    const systemPrompt = this.getEffectiveSystemPrompt(messages);

    // Bedrock supports 1h TTL only on an explicit model allowlist
    // (Opus/Sonnet/Haiku 4.5). Anything else silently falls back to 5m if
    // 1h is sent — wasteful since 1h writes cost 2× 5m writes. Gate per
    // model so we always ship the longest TTL the model actually accepts.
    const cacheOptions: CacheControlOptions = { ttl: bedrockCacheTtlFor(model) };

    const messagesWithCaching = attachMessageCacheBreakpoints(anthropicMessages, cacheOptions);
    const systemWithCaching = buildSystemWithCaching(systemPrompt, cacheOptions);

    const baseTools: Anthropic.Tool[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
    const anthropicTools = markLastToolForCaching(baseTools, cacheOptions);

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

    const systemText = Array.isArray(payload.system)
      ? payload.system.map((block) => block.text).join('')
      : (payload.system as string | undefined);
    logger.info('🔍 BEDROCK REQUEST METADATA', {
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

        logProviderRequest('bedrock', requestPayload as unknown as Record<string, unknown>);

        let response: Anthropic.Messages.Message;
        try {
          response = (await this.getBedrockClient().messages.create(requestPayload, {
            signal,
          })) as Anthropic.Messages.Message;
        } catch (providerError) {
          const classified = tryClassifyAsContextWindow(providerError, 'BedrockProvider');
          if (classified) return classified;
          throw providerError;
        }

        logProviderResponse('bedrock', response);

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
          stopReason,
          stopDetails,
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
    let streamCreated = false;

    return this.withRetry(
      async () => {
        const requestPayload = this._createRequestPayload(messages, tools, model);

        logProviderRequest('bedrock', requestPayload as unknown as Record<string, unknown>, {
          streaming: true,
        });

        const stream = this.getBedrockClient().messages.stream(requestPayload, { signal });
        streamCreated = true;

        let toolCalls: ToolCall[] = [];

        try {
          stream.on('text', (text) => {
            streamingStarted = true;
            this.emit('token', { token: text });
          });

          let estimatedOutputTokens = 0;
          let currentBlockType: string | null = null;

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
                },
              });
            }
          });

          const finalMessage = await stream.finalMessage();

          const textContent = (finalMessage.content || [])
            .filter((content): content is Anthropic.TextBlock => content.type === 'text')
            .map((content) => content.text)
            .join('');

          toolCalls = (finalMessage.content || [])
            .filter((content): content is Anthropic.ToolUseBlock => content.type === 'tool_use')
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
            stopReason,
            stopDetails,
            usage: finalMessage.usage
              ? {
                  promptTokens: finalMessage.usage.input_tokens,
                  completionTokens: finalMessage.usage.output_tokens,
                  totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
                }
              : undefined,
          };

          this.emit('complete', { response });

          return response;
        } catch (error) {
          // Run the classifier BEFORE emitting an error log: recoverable
          // context-window 400s shouldn't surface as ERROR-level noise.
          const classified = tryClassifyAsContextWindow(error, 'BedrockProvider (streaming)');
          if (classified) return classified;
          const errorObj = error as Error;
          logger.error('Streaming error from Bedrock', { error: errorObj.message });
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
