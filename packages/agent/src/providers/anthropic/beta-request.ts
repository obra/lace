// ABOUTME: Shared builder for the beta Messages API request payload used by both
// ABOUTME: the Anthropic-direct provider and the Bedrock Mantle provider.

import type Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  BetaMessageParam,
  BetaOutputConfig,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { AnthropicBeta } from '@anthropic-ai/sdk/resources/beta/beta';
import type { ProviderMessage, RequestOptions, ThinkingBlock } from '../base-provider';
import type { WireTool } from '../base-provider';
import { convertToAnthropicFormat } from '../format-converters';
import { logger } from '@lace/agent/utils/logger';
import {
  attachMessageCacheBreakpoints,
  buildSystemWithCaching,
  enforceBreakpointBudget,
  markLastToolForCaching,
  type CacheControlOptions,
} from '../cache-control';
import { sanitizeLoneSurrogates } from './well-formed-json';

// Anthropic-direct and Bedrock Mantle both support the 1h ephemeral cache TTL
// GA (no `anthropic-beta` header required — verified against
// platform.claude.com prompt-caching docs and live against Bedrock Mantle on
// 2026-07-23: a 6.6k-token system block reported ephemeral_1h_input_tokens on
// the first call and cache_read on the second).
const SHARED_CACHE_OPTIONS: CacheControlOptions = { ttl: '1h' };

/**
 * Everything the shared builder needs. The caller computes the provider-specific
 * policy inputs (`betas`, `reasoningEffort`, `outputFormat`, `diagnostics`) and
 * this function assembles them into the wire payload with cache breakpoints,
 * adaptive thinking, and the send-boundary surrogate guard.
 */
export interface BuildBetaPayloadInput {
  /** Provider label used in the request-metadata log line (e.g. 'anthropic', 'bedrock'). */
  providerName: string;
  messages: ProviderMessage[];
  systemPrompt: string;
  tools: WireTool[];
  model: string;
  maxTokens: number;
  /** Fully-resolved, deduped betas[] array for this request. */
  betas: AnthropicBeta[];
  /**
   * Reasoning effort level (e.g. 'medium'). When present, adaptive thinking is
   * enabled alongside it. Undefined ⇒ neither effort nor thinking is sent.
   */
  reasoningEffort?: string;
  /**
   * Native structured-output JSON schema. Attached as `output_config.format`.
   * Callers on backends that don't support structured outputs omit this.
   */
  outputFormat?: RequestOptions['outputFormat'];
  /**
   * Request-level cache diagnostics opt-in. Callers on backends that don't
   * support the cache-diagnosis beta omit this.
   */
  diagnostics?: { previous_message_id: string | null };
  /** Config key names, logged for debugging (never the values). */
  configKeys: string[];
}

/**
 * Build the beta Messages API `MessageCreateParams` shared by the Anthropic and
 * Bedrock providers: cache_control breakpoints (system + last tool + message
 * anchor/tail at 1h TTL), betas[], adaptive thinking + effort, optional
 * structured-output format and cache diagnostics, and a lone-surrogate guard at
 * the send boundary.
 */
export function buildBetaMessagePayload(
  input: BuildBetaPayloadInput
): Anthropic.Beta.Messages.MessageCreateParams {
  const anthropicMessages = convertToAnthropicFormat(input.messages);

  // Rolling-tail + stable-anchor breakpoints keep the conversation prefix
  // cached across idle gaps and survive the 20-raw-block lookback window.
  const messagesWithCaching = attachMessageCacheBreakpoints(
    anthropicMessages,
    SHARED_CACHE_OPTIONS
  );
  const systemWithCaching = buildSystemWithCaching(input.systemPrompt, SHARED_CACHE_OPTIONS);

  const baseTools: Anthropic.Tool[] = input.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
  const anthropicTools = markLastToolForCaching(baseTools, SHARED_CACHE_OPTIONS);

  // Defensive cap at Anthropic's 4-marker hard limit.
  const cappedMessages = enforceBreakpointBudget({
    system: systemWithCaching,
    tools: anthropicTools,
    messages: messagesWithCaching,
  });

  const diagnosticsField = input.diagnostics ? { diagnostics: input.diagnostics } : {};

  // Effort rides in the same output_config object as any structured-output
  // format; adaptive thinking is enabled alongside effort.
  const outputConfig: BetaOutputConfig = {
    ...(input.outputFormat ? { format: input.outputFormat } : {}),
    ...(input.reasoningEffort
      ? { effort: input.reasoningEffort as BetaOutputConfig['effort'] }
      : {}),
  };
  const outputConfigField =
    Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {};
  const thinkingField = input.reasoningEffort
    ? { thinking: { type: 'adaptive' as const, display: 'summarized' as const } }
    : {};

  // The beta endpoint param shape is structurally compatible with the base
  // MessageParam; cast at this single boundary rather than widening the
  // format-converter return type.
  const payload: Anthropic.Beta.Messages.MessageCreateParams = {
    model: input.model,
    max_tokens: input.maxTokens,
    messages: cappedMessages as unknown as BetaMessageParam[],
    system: systemWithCaching,
    tools: anthropicTools,
    betas: input.betas,
    ...diagnosticsField,
    ...outputConfigField,
    ...thinkingField,
  };

  const systemText = Array.isArray(payload.system)
    ? payload.system.map((block) => block.text).join('')
    : (payload.system as string | undefined);
  logger.info(`🔍 ${input.providerName.toUpperCase()} REQUEST METADATA`, {
    model: payload.model,
    maxTokens: payload.max_tokens,
    messageCount: payload.messages.length,
    systemPromptLength: systemText?.length || 0,
    systemPromptPreview: systemText?.substring(0, 100) + '...',
    toolCount: payload.tools?.length || 0,
    toolNames: payload.tools?.map((t) => ('name' in t ? t.name : '<server-tool>')),
    configKeys: input.configKeys,
    providerName: input.providerName,
    // Whether the request carries a structured-output format, and whether it
    // carries thinking/effort alongside it. Logged because the combination is
    // load-bearing: a model can REFUSE a structured-output request that has no
    // thinking, returning an empty body that reads downstream as malformed
    // JSON. Without these fields the request that failed looks identical to
    // one that worked, which is exactly how a credential-arbiter outage stayed
    // invisible for hours.
    hasOutputFormat: input.outputFormat !== undefined,
    reasoningEffort: input.reasoningEffort ?? null,
    thinking: thinkingField.thinking?.type ?? null,
  });

  // Final send-boundary guard: a lone UTF-16 surrogate anywhere in the request
  // makes the body invalid JSON for the Anthropic parser and fails the turn
  // non-retryably. Clean payloads are returned unchanged (cache identity intact).
  return sanitizeLoneSurrogates(payload);
}

/**
 * Build the `countTokens` params with the same cache_control breakpoints the
 * real request carries, so the counted total matches what we actually send
 * (cache_control fields add real overhead, and an array-shaped system block is
 * counted differently than a bare string). Shared by both providers' token
 * counting.
 */
export function buildCountTokensParams(
  messages: ProviderMessage[],
  systemPrompt: string,
  tools: WireTool[]
): {
  messages: Anthropic.MessageParam[];
  system: Anthropic.TextBlockParam[];
  tools?: Anthropic.Tool[];
} {
  const anthropicMessages = convertToAnthropicFormat(messages);
  const messagesWithCaching = attachMessageCacheBreakpoints(
    anthropicMessages,
    SHARED_CACHE_OPTIONS
  );
  const systemWithCaching = buildSystemWithCaching(systemPrompt, SHARED_CACHE_OPTIONS);
  const baseTools: Anthropic.Tool[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
  const anthropicTools = markLastToolForCaching(baseTools, SHARED_CACHE_OPTIONS);
  return {
    messages: messagesWithCaching,
    system: systemWithCaching,
    ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
  };
}

/**
 * Pull thinking + redacted_thinking blocks out of a beta response's content
 * array, preserving wire order, so the runner can persist them and replay them
 * verbatim on the next turn (Anthropic adaptive thinking). Returns undefined
 * when the model produced no reasoning blocks.
 */
export function extractThinkingBlocks(
  content: BetaMessage['content'] | undefined
): ThinkingBlock[] | undefined {
  const blocks: ThinkingBlock[] = [];
  for (const block of content || []) {
    if (block.type === 'thinking') {
      blocks.push({ type: 'thinking', thinking: block.thinking, signature: block.signature });
    } else if (block.type === 'redacted_thinking') {
      blocks.push({ type: 'redacted_thinking', data: block.data });
    }
  }
  return blocks.length > 0 ? blocks : undefined;
}
