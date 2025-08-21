// ABOUTME: Tests for thread event type definitions and token usage
// ABOUTME: Validates that events can store token usage data correctly

import { describe, it, expect } from 'vitest';
import type { LaceEvent } from '~/threads/types';

describe('LaceEvent token usage', () => {
  it('should allow AGENT_MESSAGE with token usage', () => {
    const event: LaceEvent = {
      id: 'evt_123',
      threadId: 'thread_123',
      type: 'AGENT_MESSAGE',
      timestamp: new Date(),
      data: {
        content: 'Hello',
        tokenUsage: {
          message: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          thread: {
            totalPromptTokens: 100,
            totalCompletionTokens: 50,
            totalTokens: 150,
            contextLimit: 200000,
            percentUsed: 0.1,
            nearLimit: false,
          },
        },
      },
    };

    expect(event.data.tokenUsage).toBeDefined();
    expect(event.data.tokenUsage?.thread.totalTokens).toBe(150);
  });

  it('should allow AGENT_MESSAGE without token usage', () => {
    const event: LaceEvent = {
      id: 'evt_123',
      threadId: 'thread_123',
      type: 'AGENT_MESSAGE',
      timestamp: new Date(),
      data: {
        content: 'Hello',
      },
    };

    expect(event.data.tokenUsage).toBeUndefined();
  });

  it('should allow TOOL_RESULT with token usage', () => {
    const event: LaceEvent = {
      id: 'evt_456',
      threadId: 'thread_123',
      type: 'TOOL_RESULT',
      timestamp: new Date(),
      data: {
        content: [{ type: 'text', text: 'Tool output' }],
        status: 'completed',
        tokenUsage: {
          message: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
          thread: {
            totalPromptTokens: 50,
            totalCompletionTokens: 25,
            totalTokens: 75,
            contextLimit: 200000,
            percentUsed: 0.1,
            nearLimit: false,
          },
        },
      },
    };

    expect(event.data.tokenUsage).toBeDefined();
    expect(event.data.tokenUsage?.message?.promptTokens).toBe(50);
  });

  it('should allow TOOL_RESULT without token usage', () => {
    const event: LaceEvent = {
      id: 'evt_456',
      threadId: 'thread_123',
      type: 'TOOL_RESULT',
      timestamp: new Date(),
      data: {
        content: [{ type: 'text', text: 'Tool output' }],
        status: 'completed',
      },
    };

    expect(event.data.tokenUsage).toBeUndefined();
  });
});
