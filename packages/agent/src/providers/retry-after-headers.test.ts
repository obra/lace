// ABOUTME: PRI-2896 follow-up — the SDKs hand us a `Headers` instance on API
// ABOUTME: errors, whose values bracket access cannot reach. While the SDKs ran
// ABOUTME: their own retry loops they honored Retry-After for us; with
// ABOUTME: SDK-internal retries disabled, lace is the only reader left, so a
// ABOUTME: 429's server-supplied delay must actually be parsed.

import { describe, it, expect } from 'vitest';
import { AnthropicProvider } from './anthropic-provider';

class ProbeProvider extends AnthropicProvider {
  public rateLimitDelay(error: unknown): number | null {
    return this.extractRateLimitDelay(error);
  }
}

function provider(): ProbeProvider {
  return new ProbeProvider({ apiKey: 'test-key' });
}

describe('extractRateLimitDelay reads Retry-After from a Headers instance', () => {
  it('parses Retry-After delivered as a Headers instance (the SDK shape)', () => {
    const error = Object.assign(new Error('429 rate limited'), {
      headers: new Headers({ 'retry-after': '42' }),
    });

    expect(provider().rateLimitDelay(error)).toBe(42_000);
  });

  it('still parses Retry-After from a plain-object header bag', () => {
    const error = Object.assign(new Error('429 rate limited'), {
      headers: { 'retry-after': '7' },
    });

    expect(provider().rateLimitDelay(error)).toBe(7_000);
  });

  it('returns null when no Retry-After is present', () => {
    const error = Object.assign(new Error('429 rate limited'), {
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    expect(provider().rateLimitDelay(error)).toBeNull();
  });
});
