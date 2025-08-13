// ABOUTME: Tests for API type definitions ensuring proper separation of concerns
// ABOUTME: Validates AgentResponse includes tokenUsage as a wrapper type with value

import { describe, it, expect } from 'vitest';
import type { AgentWithTokenUsage } from './api';
import { asThreadId } from '@/types/core';

describe('API Type Definitions', () => {
  it('should include tokenUsage in AgentWithTokenUsage', () => {
    const agent: AgentWithTokenUsage = {
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
    };

    expect(agent.tokenUsage?.totalTokens).toBe(1500);
  });
});
