// ABOUTME: Centralized serialization for client-server communication
// ABOUTME: Uses superjson to preserve types across API boundaries and SSE

import superjson from 'superjson';

// NOTE: We intentionally do NOT register custom transformers for ThreadId or
// WorkspaceSessionId. These are branded string types for compile-time safety only.
// At runtime they're just strings - superjson handles them fine without transformers.
// Registering transformers caused bugs where arbitrary strings (like streaming tokens)
// matched the loose regex and got incorrectly marked as session IDs.

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
