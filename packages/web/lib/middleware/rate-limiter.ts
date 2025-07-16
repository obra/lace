// ABOUTME: Simple in-memory rate limiter for API endpoints
// ABOUTME: Tracks request counts per IP/session to prevent abuse

import { NextRequest, NextResponse } from 'next/server';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  keyGenerator?: (req: NextRequest) => string; // Custom key generator
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory storage for rate limit tracking
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000);

export function createRateLimiter(config: RateLimitConfig) {
  const { windowMs, maxRequests, keyGenerator } = config;

  return function rateLimiter(req: NextRequest): NextResponse | null {
    // Generate key for rate limiting (default to IP address)
    const defaultKey =
      req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
    const key: string = keyGenerator ? keyGenerator(req) : defaultKey;

    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (!entry || entry.resetTime < now) {
      // Create new entry
      rateLimitStore.set(key, {
        count: 1,
        resetTime: now + windowMs,
      });
      return null; // Allow request
    }

    if (entry.count >= maxRequests) {
      // Rate limit exceeded
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': retryAfter.toString(),
            'X-RateLimit-Limit': maxRequests.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(entry.resetTime).toISOString(),
          },
        }
      );
    }

    // Increment count
    entry.count++;
    return null; // Allow request
  };
}

// Pre-configured rate limiters for different endpoints
export const sessionCreationLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10, // 10 sessions per minute
});

export const messageLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 60, // 60 messages per minute
});

export const taskLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30, // 30 task operations per minute
});

export const sseLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 5, // 5 SSE connections per minute
  keyGenerator: (req): string => {
    // Rate limit by session ID for SSE
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('sessionId');
    const fallbackKey =
      req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
    return sessionId ?? fallbackKey;
  },
});
