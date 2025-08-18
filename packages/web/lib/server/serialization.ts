// ABOUTME: Server-only serialization helpers for API routes
// ABOUTME: Uses NextResponse for optimized server-side JSON responses

import { NextResponse } from 'next/server';
import { stringify } from '@/lib/serialization';

// Next.js API route helper that preserves NextResponse optimizations
export function createSuperjsonResponse<T>(data: T, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');

  return new NextResponse(stringify(data), {
    ...init,
    headers,
  });
}
