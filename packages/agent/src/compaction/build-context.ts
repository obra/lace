// ABOUTME: Factory that constructs a CompactionContext with ctx.query bound to oneShotQuery
// ABOUTME: Converts {prompt, system} → messages and defaults model to the session modelId

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
 * - `query({prompt, system})` → prepends a system message
 * - `query({messages})` → passed through directly (prompt/system ignored)
 * - `query({model})` → overrides the session modelId for this call
 */
export function buildCompactionContext(
  opts: {
    threadId: string;
    sessionDir: string;
    connectionId: string;
    modelId: string;
    guidance?: string;
  },
  deps?: BuildContextDeps
): CompactionContext {
  const query = deps?.oneShotQuery ?? defaultOneShotQuery;

  return {
    threadId: opts.threadId,
    sessionDir: opts.sessionDir,
    ...(opts.guidance !== undefined ? { guidance: opts.guidance } : {}),
    query(qopts) {
      const model = qopts.model ?? opts.modelId;
      let messages: ProviderMessage[];
      if (qopts.messages) {
        messages = qopts.messages;
      } else if (qopts.system) {
        messages = [
          { role: 'system', content: qopts.system },
          { role: 'user', content: qopts.prompt ?? '' },
        ];
      } else {
        messages = [{ role: 'user', content: qopts.prompt ?? '' }];
      }
      return query({ connectionId: opts.connectionId, model, messages, signal: qopts.signal });
    },
  };
}
