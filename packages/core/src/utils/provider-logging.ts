// ABOUTME: Utility functions for pretty-printing provider payloads in debug logs
// ABOUTME: Handles message truncation and formatting for better readability

import { logger } from '~/utils/logger';

/**
 * Truncates messages array to show only preamble (first few) and recent messages
 */
function truncateMessages(
  messages: unknown[],
  maxMessages = 5
): {
  preamble: unknown[];
  recentMessages: unknown[];
  totalCount: number;
  truncatedCount: number;
} {
  const totalCount = messages.length;

  if (totalCount <= maxMessages) {
    return {
      preamble: messages,
      recentMessages: [],
      totalCount,
      truncatedCount: 0,
    };
  }

  // Show first 2 messages (usually system + first user message) and last 3
  const preambleCount = Math.min(2, messages.length);
  const recentCount = Math.min(3, messages.length - preambleCount);

  const preamble = messages.slice(0, preambleCount);
  const recentMessages = messages.slice(-recentCount);
  const truncatedCount = totalCount - preambleCount - recentCount;

  return {
    preamble,
    recentMessages,
    totalCount,
    truncatedCount,
  };
}

/**
 * Creates a truncated version of the payload for more readable logging
 */
function createTruncatedPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const { messages, ...rest } = payload;

  if (!messages || !Array.isArray(messages)) {
    // If no messages array (might be Anthropic without messages), return as-is
    return { ...rest };
  }

  const truncatedMessages = truncateMessages(messages);

  return {
    ...rest,
    messages: truncatedMessages,
  };
}

/**
 * Logs provider request payload with pretty formatting and optional truncation
 */
export function logProviderRequest(
  providerName: string,
  payload: Record<string, unknown>,
  options: { truncate?: boolean; streaming?: boolean } = {}
): void {
  const { truncate = true, streaming = false } = options;

  const logType = streaming ? 'streaming request' : 'request';
  const messageCount = Array.isArray(payload.messages) ? payload.messages.length : 0;
  const toolCount = Array.isArray(payload.tools) ? payload.tools.length : 0;
  const systemPromptLength = payload.system
    ? typeof payload.system === 'string'
      ? payload.system.length
      : Array.isArray(payload.system)
        ? payload.system.length
        : 0
    : 0;

  // Log summary info
  logger.debug(`${providerName} ${logType}`, {
    provider: providerName,
    model: payload.model,
    messageCount,
    toolCount,
    ...(systemPromptLength > 0 && { systemPromptLength }),
    ...(Array.isArray(payload.tools) &&
      payload.tools.length > 0 && {
        toolNames: payload.tools
          .map((tool) => {
            if (tool && typeof tool === 'object' && 'name' in tool) {
              const record = tool as Record<string, unknown>;
              return typeof record.name === 'string' ? record.name : undefined;
            }
            return undefined;
          })
          .filter((name): name is string => name !== undefined),
      }),
  });

  // Log the payload - truncated by default for readability
  const payloadToLog = truncate ? createTruncatedPayload(payload) : payload;

  // Use direct stderr write for structured pretty-printing instead of logger.debug
  // This avoids double JSON.stringify and makes it much more readable
  if (logger.shouldLog('debug')) {
    const output = `\n=== ${providerName.toUpperCase()} ${logType.toUpperCase()} PAYLOAD ===\n${JSON.stringify(payloadToLog, null, 2)}\n=== END ${providerName.toUpperCase()} PAYLOAD ===\n\n`;
    process.stderr.write(output);
  }
}

/**
 * Logs provider response payload with pretty formatting
 */
export function logProviderResponse(
  providerName: string,
  response: unknown,
  options: { streaming?: boolean } = {}
): void {
  const { streaming = false } = options;
  const logType = streaming ? 'streaming response' : 'response';

  // Extract basic info if it's a structured response
  const responseInfo: Record<string, unknown> = { provider: providerName };

  if (response && typeof response === 'object') {
    const resp = response as Record<string, unknown>;

    // Common response fields to extract for summary
    if ('content' in resp && Array.isArray(resp.content)) {
      responseInfo.contentBlocks = resp.content.length;
    }
    if ('usage' in resp && resp.usage && typeof resp.usage === 'object') {
      responseInfo.usage = resp.usage;
    }
    if ('choices' in resp && Array.isArray(resp.choices)) {
      responseInfo.choiceCount = resp.choices.length;
    }
  }

  // Log summary info
  logger.debug(`${providerName} ${logType}`, responseInfo);

  // Log the full response payload with pretty-printing
  if (logger.shouldLog('debug')) {
    const output = `\n=== ${providerName.toUpperCase()} ${logType.toUpperCase()} PAYLOAD ===\n${JSON.stringify(response, null, 2)}\n=== END ${providerName.toUpperCase()} RESPONSE ===\n\n`;
    process.stderr.write(output);
  }
}
