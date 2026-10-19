// ABOUTME: Joins model invocations to existing runtime logs and local proxy captures.
// ABOUTME: Request-scoped diagnostic identifiers do not select providers or change retries.
import { randomUUID } from 'node:crypto';
import type { ModelCallCorrelation } from './base-provider';
import { logger } from '@lace/agent/utils/logger';

export function createModelCallCorrelation(owner: {
  sessionId?: string;
  turnId?: string;
}): ModelCallCorrelation {
  const correlation = {
    ...(owner.sessionId !== undefined ? { sessionId: owner.sessionId } : {}),
    ...(owner.turnId !== undefined ? { turnId: owner.turnId } : {}),
    modelCallId: randomUUID(),
  };
  try {
    logger.info('model.call', correlation);
  } catch {
    // Diagnostic recording must not change whether the model call runs.
  }
  return correlation;
}

export function proxyCorrelationHeaders(
  baseUrl: string,
  correlation?: ModelCallCorrelation
): Record<string, string> {
  if (!correlation) return {};
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !/^\/anthropic\/[^/]+\/?$/.test(url.pathname)
    )
      return {};
  } catch {
    return {};
  }
  return {
    ...(correlation.sessionId ? { 'X-Lace-Session-Id': correlation.sessionId } : {}),
    ...(correlation.turnId ? { 'X-Lace-Turn-Id': correlation.turnId } : {}),
    'X-Lace-Model-Call-Id': correlation.modelCallId,
  };
}
