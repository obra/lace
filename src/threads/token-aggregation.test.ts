// ABOUTME: Tests for token aggregation utilities
// ABOUTME: Validates token counting and estimation across conversation events

import { describe, it, expect } from 'vitest';
import { aggregateTokenUsage, estimateConversationTokens } from '~/threads/token-aggregation';
import type { ThreadEvent } from '~/threads/types';

describe('Token aggregation', () => {
  it('should aggregate token usage from events', () => {
    const events: ThreadEvent[] = [
      {
        id: '1',
        threadId: 'test',
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: {
          content: 'Response 1',
          tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        },
      },
      {
        id: '2',
        threadId: 'test',
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: {
          content: 'Response 2',
          tokenUsage: { promptTokens: 200, completionTokens: 75, totalTokens: 275 },
        },
      },
    ];

    const summary = aggregateTokenUsage(events);

    expect(summary.totalPromptTokens).toBe(300);
    expect(summary.totalCompletionTokens).toBe(125);
    expect(summary.totalTokens).toBe(425);
    expect(summary.eventCount).toBe(2);
  });

  it('should handle mixed events with and without token usage', () => {
    const events: ThreadEvent[] = [
      {
        id: '1',
        threadId: 'test',
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: {
          content: 'Response with tokens',
          tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        },
      },
      {
        id: '2',
        threadId: 'test',
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: {
          content: 'Response without tokens',
          // No tokenUsage
        },
      },
      {
        id: '3',
        threadId: 'test',
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'User message',
      },
    ];

    const summary = aggregateTokenUsage(events);

    expect(summary.totalPromptTokens).toBe(100);
    expect(summary.totalCompletionTokens).toBe(50);
    expect(summary.totalTokens).toBe(150);
    expect(summary.eventCount).toBe(1); // Only one event had token usage
  });

  it('should aggregate token usage from TOOL_RESULT events', () => {
    const events: ThreadEvent[] = [
      {
        id: '1',
        threadId: 'test',
        type: 'TOOL_RESULT',
        timestamp: new Date(),
        data: {
          content: [{ type: 'text', text: 'Tool output' }],
          isError: false,
          tokenUsage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
        },
      },
    ];

    const summary = aggregateTokenUsage(events);

    expect(summary.totalPromptTokens).toBe(50);
    expect(summary.totalCompletionTokens).toBe(25);
    expect(summary.totalTokens).toBe(75);
    expect(summary.eventCount).toBe(1);
  });

  it('should estimate tokens when usage data not available', () => {
    const events: ThreadEvent[] = [
      {
        id: '1',
        threadId: 'test',
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'This is approximately twenty characters long test',
      },
    ];

    const estimated = estimateConversationTokens(events);

    // ~50 chars / 4 = ~12.5, rounded up to 13
    expect(estimated).toBeGreaterThan(10);
    expect(estimated).toBeLessThan(20);
  });

  it('should estimate tokens for mixed event types', () => {
    const events: ThreadEvent[] = [
      {
        id: '1',
        threadId: 'test',
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'Hello world', // 11 chars -> ~3 tokens
      },
      {
        id: '2',
        threadId: 'test',
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: {
          content: 'Hi there!', // 9 chars -> ~3 tokens
        },
      },
      {
        id: '3',
        threadId: 'test',
        type: 'TOOL_RESULT',
        timestamp: new Date(),
        data: {
          content: [{ type: 'text', text: 'result' }],
          isError: false,
        },
      },
    ];

    const estimated = estimateConversationTokens(events);

    // Should be roughly 6-10 tokens for the text content plus JSON overhead
    expect(estimated).toBeGreaterThan(5);
    expect(estimated).toBeLessThan(50);
  });

  it('should return zero for empty event list', () => {
    const summary = aggregateTokenUsage([]);

    expect(summary.totalPromptTokens).toBe(0);
    expect(summary.totalCompletionTokens).toBe(0);
    expect(summary.totalTokens).toBe(0);
    expect(summary.eventCount).toBe(0);
  });

  it('should return zero estimation for empty event list', () => {
    const estimated = estimateConversationTokens([]);
    expect(estimated).toBe(0);
  });
});
