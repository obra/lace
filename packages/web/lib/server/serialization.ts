// ABOUTME: Server-only serialization helpers for API routes
// ABOUTME: Creates standard Response objects with SuperJSON serialization

import { stringify } from '@/lib/serialization';

// Standard Response helper with SuperJSON serialization
export function createSuperjsonResponse<T>(data: T, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');

  return new Response(stringify(data), {
    ...init,
    headers,
  });
}
