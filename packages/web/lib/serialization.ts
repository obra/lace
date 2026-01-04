// ABOUTME: Centralized serialization for client-server communication
// ABOUTME: Uses superjson to preserve types across API boundaries and SSE

import superjson from 'superjson';
import type { ThreadId, WorkspaceSessionId } from '@lace/web/types/core';
import { isThreadId, isWorkspaceSessionId } from '@lace/web/types/core';

// Register custom transformers for branded types
superjson.registerCustom<ThreadId, string>(
  {
    isApplicable: (v): v is ThreadId => typeof v === 'string' && isThreadId(v),
    serialize: (v) => v as string,
    deserialize: (v) => v as ThreadId,
  },
  'ThreadId'
);

superjson.registerCustom<WorkspaceSessionId, string>(
  {
    isApplicable: (v): v is WorkspaceSessionId => typeof v === 'string' && isWorkspaceSessionId(v),
    serialize: (v) => v as string,
    deserialize: (v) => v as WorkspaceSessionId,
  },
  'WorkspaceSessionId'
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
