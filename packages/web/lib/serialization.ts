// ABOUTME: Centralized serialization for client-server communication
// ABOUTME: Uses superjson to preserve types across API boundaries and SSE

import superjson from 'superjson';
import type { ThreadId } from '@/types/core';
import { isThreadId } from '@/types/core';

// Import NewAgentSpec type for branded type registration
type NewAgentSpec = string & { readonly __brand: 'NewAgentSpec' };

// Register custom transformers for branded types
superjson.registerCustom<ThreadId, string>(
  {
    isApplicable: (v): v is ThreadId => typeof v === 'string' && isThreadId(v),
    serialize: (v) => v as string,
    deserialize: (v) => v as ThreadId,
  },
  'ThreadId'
);

superjson.registerCustom<NewAgentSpec, string>(
  {
    isApplicable: (v): v is NewAgentSpec =>
      typeof v === 'string' && v.startsWith('agent-') && !isThreadId(v),
    serialize: (v) => v as string,
    deserialize: (v) => v as NewAgentSpec,
  },
  'NewAgentSpec'
);

// Export the configured superjson instance (parse not exported to encourage parseResponse/parseTyped)
export const { serialize, deserialize, stringify } = superjson;
const { parse } = superjson; // Keep internal for parseResponse/parseTyped

// Typed parsing helpers for better type safety
export function parseResponse<T>(response: Response): Promise<T> {
  return response.text().then((text) => {
    // Treat empty bodies as undefined to avoid parse errors on 204/empty responses
    if (!text || !text.trim()) {
      return undefined as unknown as T;
    }
    return parse(text) as T;
  });
}

export function parseTyped<T>(text: string): T {
  return parse(text) as T;
}
