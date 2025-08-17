// ABOUTME: Centralized serialization for client-server communication
// ABOUTME: Uses superjson to preserve types across API boundaries and SSE

import superjson from 'superjson';
import { NextResponse } from 'next/server';
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

// Convenience functions for common use cases
function _serializeForAPI<T>(data: T): string {
  return stringify(data);
}

function _deserializeFromAPI<T>(data: string): T {
  return parse(data);
}

// For SSE events specifically
function _serializeEvent<T>(event: T): string {
  return stringify(event);
}

function _deserializeEvent<T>(data: string): T {
  return parse(data);
}

// Next.js API route helper that preserves NextResponse optimizations
export function createSuperjsonResponse<T>(data: T, init?: ResponseInit) {
  return new NextResponse(stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
}

// Typed parsing helpers for better type safety
export function parseResponse<T>(response: Response): Promise<T> {
  return response.text().then((text) => parse(text) as T);
}

export function parseTyped<T>(text: string): T {
  return parse(text) as T;
}
