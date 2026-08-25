// ABOUTME: Factory that constructs a CompactionContext with ctx.query bound to oneShotQuery
// ABOUTME: Converts {prompt} → messages and defaults model to the session modelId
// ABOUTME: Omits ctx.query entirely when connectionId or modelId is absent

import type { ProviderMessage, ProviderResponse } from '@lace/agent/providers/base-provider';
import { oneShotQuery as defaultOneShotQuery } from '@lace/agent/conversation/one-shot-query';
import { resolveContextWindow as defaultResolveContextWindow } from './context-window';
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
/**
 * Build a CompactionContext for a call site that holds a connection and a model
 * but no live provider — the manual compaction paths (`ent/session/compact`,
 * `/compact`). Resolves the model's context window and threads it in.
 *
 * This exists as one function rather than two lines repeated at each call site
 * because the two-line version was invisible to tests: deleting the window from
 * either handler passed the entire suite. Composed here, the composition itself
 * is testable, and the handlers are left with a single call that either happens
 * or does not.
 */
export async function buildCompactionContextForConnection(
  opts: {
    threadId: string;
    sessionDir: string;
    connectionId?: string;
    modelId?: string;
    guidance?: string;
    referenceTimestamp?: string;
  },
  deps?: BuildContextDeps & {
    resolveContextWindow?: (o: {
      connectionId?: string;
      modelId?: string;
    }) => Promise<number | undefined>;
  }
): Promise<CompactionContext> {
  const resolve = deps?.resolveContextWindow ?? defaultResolveContextWindow;
  const contextWindow = await resolve({
    connectionId: opts.connectionId,
    modelId: opts.modelId,
  });
  return buildCompactionContext(
    { ...opts, ...(contextWindow !== undefined ? { contextWindow } : {}) },
    deps
  );
}

export function buildCompactionContext(
  opts: {
    threadId: string;
    sessionDir: string;
    connectionId?: string;
    modelId?: string;
    guidance?: string;
    referenceTimestamp?: string;
    contextWindow?: number;
    measuredContextTokens?: number;
  },
  deps?: BuildContextDeps
): CompactionContext {
  const hasConnection = !!(opts.connectionId && opts.modelId);
  const query = deps?.oneShotQuery ?? defaultOneShotQuery;

  const base: CompactionContext = {
    threadId: opts.threadId,
    sessionDir: opts.sessionDir,
    referenceTimestamp: opts.referenceTimestamp ?? new Date().toISOString(),
    ...(opts.contextWindow !== undefined ? { contextWindow: opts.contextWindow } : {}),
    // Only a real, positive reading is passed on. A zero or a NaN from a
    // provider that reports nothing must arrive at the strategy as ABSENT, not
    // as "this session's context is empty" — see CompactionContext.
    ...(typeof opts.measuredContextTokens === 'number' &&
    Number.isFinite(opts.measuredContextTokens) &&
    opts.measuredContextTokens > 0
      ? { measuredContextTokens: opts.measuredContextTokens }
      : {}),
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
