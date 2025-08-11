// ABOUTME: Tests for token aggregation utilities
// ABOUTME: Validates token counting and estimation across conversation events

import { describe, it, expect } from 'vitest';
import { aggregateTokenUsage, estimateConversationTokens } from '~/threads/token-aggregation';
import type { LaceEvent } from '~/threads/types';
import type { CombinedTokenUsage } from '~/token-management/types';

describe('Token aggregation', () => {
  it('should aggregate token usage from events', () => {
    const events: LaceEvent[] = [
      {
        id: '1',
        threadId: 'test',
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: {
          content: 'Response 1',
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
      },
      {
        id: '2',
        threadId: 'test',
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: {
          content: 'Response 2',
          tokenUsage: {
            message: { promptTokens: 200, completionTokens: 75, totalTokens: 275 },
            thread: {
              totalPromptTokens: 300,
              totalCompletionTokens: 125,
              totalTokens: 425,
              contextLimit: 200000,
              percentUsed: 0.2,
              nearLimit: false,
            },
          },
        },
      },
    ];

    const summary = aggregateTokenUsage(events);

    expect(summary.totalPromptTokens).toBe(300);
    expect(summary.totalCompletionTokens).toBe(125);
    expect(summary.totalTokens).toBe(425);
  });

  it('should handle mixed events with and without token usage', () => {
    const events: LaceEvent[] = [
      {
        id: '1',
        threadId: 'test',
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: {
          content: 'Response with tokens',
          tokenUsage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          } as unknown as CombinedTokenUsage,
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
  });

  it('should aggregate token usage from TOOL_RESULT events', () => {
    const events: LaceEvent[] = [
      {
        id: '1',
        threadId: 'test',
        type: 'TOOL_RESULT',
        timestamp: new Date(),
        data: {
          content: [{ type: 'text', text: 'Tool output' }],
          status: 'completed',
          tokenUsage: {
            promptTokens: 50,
            completionTokens: 25,
            totalTokens: 75,
          } as unknown as CombinedTokenUsage,
        },
      },
    ];

    const summary = aggregateTokenUsage(events);

    expect(summary.totalPromptTokens).toBe(50);
    expect(summary.totalCompletionTokens).toBe(25);
    expect(summary.totalTokens).toBe(75);
  });

  it('should estimate tokens when usage data not available', () => {
    const events: LaceEvent[] = [
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
    const events: LaceEvent[] = [
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
          status: 'completed',
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
  });

  it('should return zero estimation for empty event list', () => {
    const estimated = estimateConversationTokens([]);
    expect(estimated).toBe(0);
  });

  describe('Token aggregation with compaction', () => {
    it('should only count events after compaction plus summary', () => {
      const events: LaceEvent[] = [
        // Original events (before compaction) - these should be ignored
        {
          id: '1',
          threadId: 'test',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01'),
          data: {
            content: 'Old response 1',
            tokenUsage: {
              promptTokens: 1000,
              completionTokens: 500,
              totalTokens: 1500,
            } as unknown as CombinedTokenUsage,
          },
        },
        {
          id: '2',
          threadId: 'test',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-02'),
          data: {
            content: 'Old response 2',
            tokenUsage: {
              promptTokens: 800,
              completionTokens: 400,
              totalTokens: 1200,
            } as unknown as CombinedTokenUsage,
          },
        },
        // Compaction event - contains summary
        {
          id: 'compaction-1',
          threadId: 'test',
          type: 'COMPACTION',
          timestamp: new Date('2024-01-03'),
          data: {
            strategyId: 'summarize',
            originalEventCount: 2,
            compactedEvents: [
              {
                id: 'summary',
                threadId: 'test',
                type: 'AGENT_MESSAGE' as const,
                timestamp: new Date('2024-01-03'),
                data: {
                  content: 'Summary of conversation',
                  tokenUsage: {
                    promptTokens: 300,
                    completionTokens: 200,
                    totalTokens: 500,
                  } as unknown as CombinedTokenUsage,
                },
              },
            ],
          },
        },
        // Post-compaction events - these should be counted
        {
          id: '3',
          threadId: 'test',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-04'),
          data: {
            content: 'New response 1',
            tokenUsage: {
              promptTokens: 150,
              completionTokens: 100,
              totalTokens: 250,
            } as unknown as CombinedTokenUsage,
          },
        },
        {
          id: '4',
          threadId: 'test',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-05'),
          data: {
            content: 'New response 2',
            tokenUsage: {
              promptTokens: 200,
              completionTokens: 150,
              totalTokens: 350,
            } as unknown as CombinedTokenUsage,
          },
        },
      ];

      const result = aggregateTokenUsage(events);

      // Should be summary (300+200) + post-compaction events (150+100+200+150)
      expect(result).toEqual({
        totalPromptTokens: 650, // 300 (summary) + 150 + 200
        totalCompletionTokens: 450, // 200 (summary) + 100 + 150
        totalTokens: 1100, // 500 (summary) + 250 + 350
      });
    });

    it('should handle multiple compactions correctly', () => {
      const events: LaceEvent[] = [
        // First batch of events
        {
          id: '1',
          threadId: 'test',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01'),
          data: {
            content: 'Old response 1',
            tokenUsage: {
              promptTokens: 1000,
              completionTokens: 500,
              totalTokens: 1500,
            } as unknown as CombinedTokenUsage,
          },
        },
        // First compaction
        {
          id: 'compaction-1',
          threadId: 'test',
          type: 'COMPACTION',
          timestamp: new Date('2024-01-02'),
          data: {
            strategyId: 'summarize',
            originalEventCount: 1,
            compactedEvents: [
              {
                id: 's1',
                threadId: 'test',
                type: 'AGENT_MESSAGE' as const,
                timestamp: new Date('2024-01-02'),
                data: {
                  content: 'First summary',
                  tokenUsage: {
                    promptTokens: 200,
                    completionTokens: 100,
                    totalTokens: 300,
                  } as unknown as CombinedTokenUsage,
                },
              },
            ],
          },
        },
        // Events after first compaction
        {
          id: '2',
          threadId: 'test',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-03'),
          data: {
            content: 'Middle response',
            tokenUsage: {
              promptTokens: 300,
              completionTokens: 200,
              totalTokens: 500,
            } as unknown as CombinedTokenUsage,
          },
        },
        // Second compaction
        {
          id: 'compaction-2',
          threadId: 'test',
          type: 'COMPACTION',
          timestamp: new Date('2024-01-04'),
          data: {
            strategyId: 'summarize',
            originalEventCount: 2,
            compactedEvents: [
              {
                id: 's2',
                threadId: 'test',
                type: 'AGENT_MESSAGE' as const,
                timestamp: new Date('2024-01-04'),
                data: {
                  content: 'Second summary',
                  tokenUsage: {
                    promptTokens: 150,
                    completionTokens: 75,
                    totalTokens: 225,
                  } as unknown as CombinedTokenUsage,
                },
              },
            ],
          },
        },
        // Final events
        {
          id: '3',
          threadId: 'test',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-05'),
          data: {
            content: 'Final response',
            tokenUsage: {
              promptTokens: 100,
              completionTokens: 50,
              totalTokens: 150,
            } as unknown as CombinedTokenUsage,
          },
        },
      ];

      const result = aggregateTokenUsage(events);

      // Should only count the latest summary (150+75) + post-compaction events (100+50)
      expect(result).toEqual({
        totalPromptTokens: 250, // 150 (latest summary) + 100
        totalCompletionTokens: 125, // 75 (latest summary) + 50
        totalTokens: 375, // 225 (latest summary) + 150
      });
    });

    it('should handle compaction with no post-compaction events', () => {
      const events: LaceEvent[] = [
        {
          id: '1',
          threadId: 'test',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01'),
          data: {
            content: 'Original response',
            tokenUsage: {
              promptTokens: 1000,
              completionTokens: 500,
              totalTokens: 1500,
            } as unknown as CombinedTokenUsage,
          },
        },
        {
          id: 'compaction-1',
          threadId: 'test',
          type: 'COMPACTION',
          timestamp: new Date('2024-01-02'),
          data: {
            strategyId: 'summarize',
            originalEventCount: 1,
            compactedEvents: [
              {
                id: 'summary',
                threadId: 'test',
                type: 'AGENT_MESSAGE' as const,
                timestamp: new Date('2024-01-02'),
                data: {
                  content: 'Summary',
                  tokenUsage: {
                    promptTokens: 200,
                    completionTokens: 100,
                    totalTokens: 300,
                  } as unknown as CombinedTokenUsage,
                },
              },
            ],
          },
        },
      ];

      const result = aggregateTokenUsage(events);

      // Should only count the summary
      expect(result).toEqual({
        totalPromptTokens: 200,
        totalCompletionTokens: 100,
        totalTokens: 300,
      });
    });

    it('should handle empty compacted events', () => {
      const events: LaceEvent[] = [
        {
          id: '1',
          threadId: 'test',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01'),
          data: {
            content: 'Original response',
            tokenUsage: {
              promptTokens: 1000,
              completionTokens: 500,
              totalTokens: 1500,
            } as unknown as CombinedTokenUsage,
          },
        },
        {
          id: 'compaction-1',
          threadId: 'test',
          type: 'COMPACTION',
          timestamp: new Date('2024-01-02'),
          data: {
            strategyId: 'delete',
            originalEventCount: 1,
            compactedEvents: [], // Empty summary
          },
        },
        {
          id: '2',
          threadId: 'test',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-03'),
          data: {
            content: 'New response',
            tokenUsage: {
              promptTokens: 100,
              completionTokens: 50,
              totalTokens: 150,
            } as unknown as CombinedTokenUsage,
          },
        },
      ];

      const result = aggregateTokenUsage(events);

      // Should only count post-compaction events
      expect(result).toEqual({
        totalPromptTokens: 100,
        totalCompletionTokens: 50,
        totalTokens: 150,
      });
    });
  });
});
