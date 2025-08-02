// ABOUTME: Centralized serialization for client-server communication
// ABOUTME: Uses superjson to preserve types across API boundaries and SSE

import superjson from 'superjson';
import { NextResponse } from 'next/server';
import type { ThreadId } from '@/types/core';

// Import NewAgentSpec type for branded type registration
type NewAgentSpec = string & { readonly __brand: 'NewAgentSpec' };

// Register custom transformers for branded types
superjson.registerCustom<ThreadId, string>(
  {
    isApplicable: (v): v is ThreadId =>
      typeof v === 'string' && v.match(/^lace_\d{8}_[a-z0-9]{6}(\.\d+)*$/),
    serialize: (v) => v as string,
    deserialize: (v) => v as ThreadId,
  },
  'ThreadId'
);

superjson.registerCustom<NewAgentSpec, string>(
  {
    isApplicable: (v): v is NewAgentSpec =>
      typeof v === 'string' && v.startsWith('agent-') && !v.match(/^lace_\d{8}_[a-z0-9]{6}/),
    serialize: (v) => v as string,
    deserialize: (v) => v as NewAgentSpec,
  },
  'NewAgentSpec'
);

// Export the configured superjson instance
export const { serialize, deserialize, stringify, parse } = superjson;

// Convenience functions for common use cases
export function serializeForAPI<T>(data: T): string {
  return stringify(data);
}

export function deserializeFromAPI<T>(data: string): T {
  return parse(data);
}

// For SSE events specifically
export function serializeEvent<T>(event: T): string {
  return stringify(event);
}

export function deserializeEvent<T>(data: string): T {
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
