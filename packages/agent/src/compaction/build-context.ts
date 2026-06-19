// ABOUTME: Factory that constructs a CompactionContext with ctx.query bound to oneShotQuery
// ABOUTME: Converts {prompt} → messages and defaults model to the session modelId
// ABOUTME: Omits ctx.query entirely when connectionId or modelId is absent

import type { ProviderMessage, ProviderResponse } from '@lace/agent/providers/base-provider';
import { oneShotQuery as defaultOneShotQuery } from '@lace/agent/conversation/one-shot-query';
import type { CompactionContext } from './types';

type OneShotQuery = typeof defaultOneShotQuery;

/**
 * Deps seam for testing — override oneShotQuery to avoid network calls.
 */
interface BuildContextDeps {
  oneShotQuery?: (
    opts: Parameters<OneShotQuery>[0]
  ) => Promise<{ text: string; usage?: ProviderResponse['usage'] }>;
}

/**
 * Build a CompactionContext for a given call site, binding ctx.query to
 * oneShotQuery so strategies can issue LLM calls without holding a raw
 * provider reference.
 *
 * - `query({prompt})` → maps to messages [{role:'user', content:prompt}]
 * - `query({messages})` → passed through directly (prompt ignored); empty
 *   arrays are treated as "no messages" and fall back to prompt handling
 * - `query({model})` → overrides the session modelId for this call
 *
 * When `connectionId` or `modelId` is falsy, `ctx.query` is omitted entirely
 * rather than bound to a function that will always throw InvalidParams.
 */
export function buildCompactionContext(
  opts: {
    threadId: string;
    sessionDir: string;
    connectionId?: string;
    modelId?: string;
    guidance?: string;
    referenceTimestamp?: string;
  },
  deps?: BuildContextDeps
): CompactionContext {
  const hasConnection = !!(opts.connectionId && opts.modelId);
  const query = deps?.oneShotQuery ?? defaultOneShotQuery;

  const base: CompactionContext = {
    threadId: opts.threadId,
    sessionDir: opts.sessionDir,
    referenceTimestamp: opts.referenceTimestamp ?? new Date().toISOString(),
    ...(opts.guidance !== undefined ? { guidance: opts.guidance } : {}),
  };

  if (!hasConnection) {
    return base;
  }

  const connectionId = opts.connectionId!;
  const modelId = opts.modelId!;

  return {
    ...base,
    query(qopts) {
      const model = qopts.model ?? modelId;
      let messages: ProviderMessage[];
      if (qopts.messages && qopts.messages.length > 0) {
        messages = qopts.messages;
      } else {
        messages = [{ role: 'user', content: qopts.prompt ?? '' }];
      }
      return query({ connectionId, model, messages, signal: qopts.signal });
    },
  };
}
