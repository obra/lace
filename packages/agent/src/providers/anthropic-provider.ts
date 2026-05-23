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

interface AnthropicProviderConfig extends ProviderConfig {
  apiKey: string | null;
  [key: string]: unknown; // Allow for additional properties
}

const ONE_HOUR_EPHEMERAL: Anthropic.CacheControlEphemeral = {
  type: 'ephemeral',
  ttl: '1h',
};

// Distance (in cacheable content blocks) between the rolling tail breakpoint
// and the stable anchor breakpoint. Anthropic's cache lookup looks back ~20
// content blocks from a breakpoint; placing the anchor 10 blocks behind the
// tail gives ~10 blocks of headroom for new blocks to land before the
// previous request's breakpoints fall out of range.
const ANCHOR_OFFSET_BLOCKS = 10;

// Thinking blocks (`type: 'thinking'` / `type: 'redacted_thinking'`) do not
// support `cache_control` — they have no such field in the SDK type and
// Anthropic's docs explicitly forbid it. They must be skipped when picking
// breakpoint targets.
type CacheableBlock = Exclude<
  Anthropic.ContentBlockParam,
  Anthropic.ThinkingBlockParam | Anthropic.RedactedThinkingBlockParam
>;

function isCacheableBlock(block: Anthropic.ContentBlockParam): block is CacheableBlock {
  return block.type !== 'thinking' && block.type !== 'redacted_thinking';
}

// A pointer into the messages array. `blockIdx` is `null` when the message's
// content is a plain string — in that case we'll lift it to a single text
// block before attaching cache_control.
interface BlockPosition {
  msgIdx: number;
  blockIdx: number | null;
}

// Walk every cacheable block across all messages. Used to compute the anchor
// position relative to the tail.
function collectCacheablePositions(messages: Anthropic.MessageParam[]): BlockPosition[] {
  const positions: BlockPosition[] = [];
  for (let m = 0; m < messages.length; m++) {
    const content = messages[m].content;
    if (typeof content === 'string') {
      if (content.length > 0) positions.push({ msgIdx: m, blockIdx: null });
    } else {
      for (let b = 0; b < content.length; b++) {
        if (isCacheableBlock(content[b])) positions.push({ msgIdx: m, blockIdx: b });
      }
    }
  }
  return positions;
}

function isMessageEmpty(msg: Anthropic.MessageParam): boolean {
  return typeof msg.content === 'string' ? msg.content.length === 0 : msg.content.length === 0;
}

// Attach up to two 1h cache_control breakpoints to message content:
//   • rolling tail — last cacheable block of the last non-empty message
//   • stable anchor — 10 cacheable blocks behind the tail
//
// The anchor exists to defeat Anthropic's 20-block lookback window: in a
// tool-heavy loop, the prior request's tail breakpoint can be pushed beyond
// 20 blocks by intervening tool_result / tool_use blocks, busting the cache.
// A second breakpoint ~10 blocks back guarantees the next request finds at
// least one matching cached prefix even after several new blocks arrive.
//
// Refuses to attach anything when the last message has empty content — the
// rolling write must always move forward, never freeze on a stale block deep
// in history.
//
// Thinking blocks are never used as breakpoint targets.
//
// Returns a new array; inputs are not mutated.
function attachMessageCacheBreakpoints(
  messages: Anthropic.MessageParam[]
): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  if (isMessageEmpty(messages[messages.length - 1])) return messages;

  const positions = collectCacheablePositions(messages);
  if (positions.length === 0) return messages;

  // Tail must live in the last message — otherwise refuse rather than
  // anchoring on history. (E.g. last message contains only thinking blocks.)
  const tail = positions[positions.length - 1];
  if (tail.msgIdx !== messages.length - 1) return messages;

  const anchor =
    positions.length > ANCHOR_OFFSET_BLOCKS
      ? positions[positions.length - 1 - ANCHOR_OFFSET_BLOCKS]
      : null;

  return applyBreakpoints(messages, anchor ? [anchor, tail] : [tail]);
}

function applyBreakpoints(
  messages: Anthropic.MessageParam[],
  positions: BlockPosition[]
): Anthropic.MessageParam[] {
  const result = messages.slice();
  const dirtyMsgIdxs = new Set(positions.map((p) => p.msgIdx));

  // Clone every message we'll touch and lift any string content to an array.
  for (const idx of dirtyMsgIdxs) {
    const msg = result[idx];
    if (typeof msg.content === 'string') {
      result[idx] = {
        ...msg,
        content: [{ type: 'text', text: msg.content }],
      };
    } else {
      result[idx] = { ...msg, content: msg.content.slice() };
    }
  }

  // Now stamp cache_control on each target block. Type juggling: after the
  // clone above, all dirty messages have array content.
  for (const pos of positions) {
    const blocks = (result[pos.msgIdx].content as CacheableBlock[]).slice();
    const targetIdx = pos.blockIdx ?? 0;
    blocks[targetIdx] = {
      ...blocks[targetIdx],
      cache_control: ONE_HOUR_EPHEMERAL,
    };
    result[pos.msgIdx] = { ...result[pos.msgIdx], content: blocks };
  }

  return result;
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

  /**
   * Helper method for token counting with explicit control over all parameters
   * Allows precise counting of individual components (system, tools, messages)
   */
  private async countTokensExplicit(
    messages: ProviderMessage[],
    systemPrompt: string,
    tools: WireTool[],
    model: string
  ): Promise<number | null> {
    try {
      const anthropicMessages = convertToAnthropicFormat(messages);
      const anthropicTools: Anthropic.Tool[] = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));

      const result = await this.getAnthropicClient().beta.messages.countTokens({
        model,
        messages: anthropicMessages,
        system: systemPrompt,
        tools: anthropicTools,
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

  /**
   * Calibrates token costs for system prompt and individual tools
   * Makes separate API calls to measure each component precisely
   */
  protected async _calibrateTokenCostsImpl(
    messages: ProviderMessage[],
    tools: WireTool[],
    model: string
  ): Promise<{
    systemTokens: number;
    toolTokens: number;
    toolDetails: Array<{ name: string; tokens: number }>;
  } | null> {
    try {
      const systemPrompt = this.getEffectiveSystemPrompt(messages);

      logger.debug('[AnthropicProvider] Starting calibration', {
        model,
        systemPromptLength: systemPrompt.length,
        toolCount: tools.length,
      });

      // Count system prompt only (no messages, no tools)
      const systemTokens = (await this.countTokensExplicit([], systemPrompt, [], model)) || 0;

      logger.debug('[AnthropicProvider] System prompt counted', { systemTokens });

      // Count each tool individually (no system, no messages)
      const toolDetails = await Promise.all(
        tools.map(async (tool) => ({
          name: tool.name,
          tokens: (await this.countTokensExplicit([], '', [tool], model)) || 0,
        }))
      );

      const toolTokens = toolDetails.reduce((sum, t) => sum + t.tokens, 0);

      logger.debug('[AnthropicProvider] Tools counted', {
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
      logger.error('[AnthropicProvider] Calibration failed', { error });
      logger.debug('Token calibration failed', { error });
      return null;
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
    tools: WireTool[],
    model: string
  ): Anthropic.Messages.MessageCreateParams {
    // Convert our enhanced generic messages to Anthropic format
    const anthropicMessages = convertToAnthropicFormat(messages);

    // PRI-1799: also attach a cache_control breakpoint to the most recent
    // message-content block so the conversation prefix stays cached across
    // long idle gaps (1h TTL). Without this, only system+tools cache and
    // every multi-minute-idle turn re-bills the whole prefix.
    const messagesWithCaching = attachMessageCacheBreakpoints(anthropicMessages);

    // Extract system message if present
    const systemPrompt = this.getEffectiveSystemPrompt(messages);

    // Format system prompt as array with cache_control for Anthropic's prompt caching
    const systemWithCaching: Anthropic.TextBlockParam[] = [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: ONE_HOUR_EPHEMERAL,
      },
    ];

    // Convert tools to Anthropic format with cache_control on the last tool only
    // Adding cache_control to the last tool enables caching of the entire tool list
    const anthropicTools: Anthropic.Tool[] = tools.map((tool, index) => {
      const baseTool: Anthropic.Tool = {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      };

      // Add cache_control to the last tool only
      if (index === tools.length - 1) {
        return {
          ...baseTool,
          cache_control: ONE_HOUR_EPHEMERAL,
        };
      }

      return baseTool;
    });

    const payload = {
      model,
      max_tokens: this._config.maxTokens || this.getModelMaxOutputTokens(model, 8192),
      messages: messagesWithCaching,
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
