// ABOUTME: Tests for agent context helper functions
// ABOUTME: Ensures type-safe extraction of Agent from Next.js request context

import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { getAgentFromRequest } from '../agent-context';
import type { Agent } from '~/agents/agent';

describe('getAgentFromRequest', () => {
  it('should return agent when available', () => {
    const mockAgent = {
      generateThreadId: () => 'test-thread-id',
    } as Agent;
    
    const request = new NextRequest('http://localhost:3000');
    // Simulate what web-interface.ts does
    (request as any).laceAgent = mockAgent;
    
    const result = getAgentFromRequest(request);
    expect(result).toBe(mockAgent);
  });

  it('should throw when agent not available', () => {
    const request = new NextRequest('http://localhost:3000');
    
    expect(() => getAgentFromRequest(request)).toThrow(
      'Agent not available in request context. WebInterface must be running in integrated mode.'
    );
  });
});