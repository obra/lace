// ABOUTME: Tests for API type definitions ensuring proper separation of concerns
// ABOUTME: Validates SessionResponse has no tokenUsage and AgentResponse includes tokenUsage

import { describe, it, expect } from 'vitest';
import type { SessionResponse, AgentResponse } from './api';
import { asThreadId } from '@/types/core';

describe('API Type Definitions', () => {
  it('should not include tokenUsage in SessionResponse', () => {
    const response: SessionResponse = {
      session: {
        id: asThreadId('lace_20241122_abc123'),
        name: 'Test Session',
        createdAt: new Date(),
        agents: [],
      },
      // Should NOT have tokenUsage field
    };

    expect(response.session.name).toBe('Test Session');

    // TypeScript should not allow tokenUsage field
    // @ts-expect-error - tokenUsage should not exist on SessionResponse
    expect(response.tokenUsage).toBeUndefined();
  });

  it('should include tokenUsage in AgentResponse', () => {
    const response: AgentResponse = {
      agent: {
        threadId: asThreadId('lace_20241122_abc123.1'),
        name: 'Test Agent',
        providerInstanceId: 'test-provider',
        modelId: 'claude-3-sonnet',
        status: 'idle',
        tokenUsage: {
          totalPromptTokens: 1000,
          totalCompletionTokens: 500,
          totalTokens: 1500,
          contextLimit: 200000,
          percentUsed: 0.75,
          nearLimit: false,
        },
      },
    };

    expect(response.agent.tokenUsage?.totalTokens).toBe(1500);
  });
});
