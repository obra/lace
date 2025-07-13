// ABOUTME: Tests for web interface TypeScript types
// ABOUTME: Ensures type safety for Agent request context without any casts

import { describe, it, expect } from 'vitest';
import type { IncomingMessage } from 'http';
import type { LaceRequest } from '~/interfaces/web/types';
import type { Agent } from '~/agents/agent';

describe('LaceRequest type', () => {
  it('should extend IncomingMessage', () => {
    // Type-only test - if this compiles, the type extends correctly
    const baseMessage: IncomingMessage = {} as IncomingMessage;
    const laceRequest: LaceRequest = baseMessage;

    expect(laceRequest).toBeDefined();
  });

  it('should have optional laceAgent property', () => {
    const request: LaceRequest = {} as LaceRequest;

    // Should be able to assign Agent or undefined
    request.laceAgent = {} as Agent;
    request.laceAgent = undefined;

    expect(request.laceAgent).toBeUndefined();
  });

  it('should maintain IncomingMessage properties', () => {
    const request: LaceRequest = {
      url: '/api/test',
      method: 'POST',
    } as LaceRequest;

    expect(request.url).toBe('/api/test');
    expect(request.method).toBe('POST');
  });
});
