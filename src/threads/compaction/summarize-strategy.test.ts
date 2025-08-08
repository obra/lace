// ABOUTME: Tests for AI-powered conversation summarization compaction strategy
// ABOUTME: Validates summarization logic and event replacement behavior

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SummarizeCompactionStrategy } from '~/threads/compaction/summarize-strategy';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import type { ThreadEvent } from '~/threads/types';
import type { CompactionContext, CompactionData } from '~/threads/compaction/types';

// Helper to cast result data to CompactionData
function getCompactionData(result: ThreadEvent): CompactionData {
  return result.data as CompactionData;
}

// Mock provider for testing summarization
class MockSummarizationProvider extends BaseMockProvider {
  providerName = 'mock-summarization';

  constructor(mockSummary = 'Summary of conversation about writing functions') {
    super({});
    this.mockSummary = mockSummary;
  }

  private mockSummary: string;

  createResponse = vi.fn().mockImplementation(() =>
    Promise.resolve({
      content: this.mockSummary,
      toolCalls: [],
    })
  );

  get supportsStreaming() {
    return false;
  }

  setMockSummary(summary: string) {
    this.mockSummary = summary;
    this.createResponse.mockImplementation(() =>
      Promise.resolve({
        content: summary,
        toolCalls: [],
      })
    );
  }
}

describe('SummarizeCompactionStrategy', () => {
  setupCoreTest();
  let strategy: SummarizeCompactionStrategy;
  let mockProvider: MockSummarizationProvider;
  let agent: Agent;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;
  let context: CompactionContext;

  beforeEach(() => {
    strategy = new SummarizeCompactionStrategy();
    mockProvider = new MockSummarizationProvider();
    threadManager = new ThreadManager();
    toolExecutor = new ToolExecutor();

    // Create test thread
    const threadId = threadManager.createThread();

    // Create agent with mock provider
    agent = new Agent({
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    context = {
      threadId,
      agent, // Use agent for in-conversation summarization
    };
  });

  it('should create summary from conversation events', async () => {
    const events: ThreadEvent[] = [
      {
        id: '1',
        threadId: context.threadId,
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        data: 'Help me write a function to calculate fibonacci numbers',
      },
      {
        id: '2',
        threadId: context.threadId,
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:01:00Z'),
        data: {
          content: 'I can help you write a fibonacci function. Here are a few approaches...',
          tokenUsage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
        },
      },
      {
        id: '3',
        threadId: context.threadId,
        type: 'TOOL_CALL',
        timestamp: new Date('2024-01-01T10:02:00Z'),
        data: {
          id: 'tool-123',
          name: 'file_write',
          arguments: { path: 'fibonacci.js', content: 'function fib(n) { ... }' },
        },
      },
    ];

    const result = await strategy.compact(events, context);

    expect(result.type).toBe('COMPACTION');
    expect(result.threadId).toBe(context.threadId);

    const compactionData = getCompactionData(result);
    expect(compactionData.strategyId).toBe('summarize');
    expect(compactionData.originalEventCount).toBe(3);
    expect(compactionData.compactedEvents).toHaveLength(1);

    // Should create a summary event
    const summaryEvent = compactionData.compactedEvents[0];
    expect(summaryEvent.type).toBe('LOCAL_SYSTEM_MESSAGE');
    expect(summaryEvent.data).toContain('Summary of conversation about writing functions');
  });

  it('should preserve recent events', async () => {
    const events: ThreadEvent[] = [
      // Old events to be summarized (first 2)
      {
        id: '1',
        threadId: 'test-thread-123',
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        data: 'Old message 1',
      },
      {
        id: '2',
        threadId: 'test-thread-123',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:01:00Z'),
        data: { content: 'Old response 1' },
      },
      {
        id: '3',
        threadId: 'test-thread-123',
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:02:00Z'),
        data: 'Old message 2',
      },
      {
        id: '4',
        threadId: 'test-thread-123',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:03:00Z'),
        data: { content: 'Old response 2' },
      },
      // Recent events to preserve (last 4, but strategy keeps last 4 events)
      {
        id: '5',
        threadId: 'test-thread-123',
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:10:00Z'),
        data: 'Recent message 1',
      },
      {
        id: '6',
        threadId: 'test-thread-123',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:11:00Z'),
        data: { content: 'Recent response 1' },
      },
    ];

    const result = await strategy.compact(events, context);
    const compactionData = getCompactionData(result);

    expect(compactionData.compactedEvents).toHaveLength(3); // summary + 2 recent events (last 2)

    // First event should be summary
    expect(compactionData.compactedEvents[0].type).toBe('LOCAL_SYSTEM_MESSAGE');

    // Last two events should be preserved
    expect(compactionData.compactedEvents[1].data).toBe('Recent message 1');
    const agentMessageData = compactionData.compactedEvents[2].data as { content: string };
    expect(agentMessageData.content).toBe('Recent response 1');
  });

  it('should handle tool calls and results appropriately', async () => {
    const events: ThreadEvent[] = [
      {
        id: '1',
        threadId: 'test-thread-123',
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        data: 'Create a file',
      },
      {
        id: '2',
        threadId: 'test-thread-123',
        type: 'TOOL_CALL',
        timestamp: new Date('2024-01-01T10:01:00Z'),
        data: {
          id: 'tool-123',
          name: 'file_write',
          arguments: { path: 'test.txt', content: 'Hello world' },
        },
      },
      {
        id: '3',
        threadId: 'test-thread-123',
        type: 'TOOL_RESULT',
        timestamp: new Date('2024-01-01T10:02:00Z'),
        data: {
          content: [{ type: 'text', text: 'File created successfully' }],
          isError: false,
        },
      },
    ];

    const result = await strategy.compact(events, context);

    // Should preserve tool interactions
    const compactionData = getCompactionData(result);
    expect(compactionData.compactedEvents).toHaveLength(1); // Just the summary since all are old
    expect(compactionData.compactedEvents[0].type).toBe('LOCAL_SYSTEM_MESSAGE');
    expect(compactionData.compactedEvents[0].data).toContain(
      'Summary of conversation about writing functions'
    );
  });

  it('should throw error when no agent or provider available', async () => {
    const events: ThreadEvent[] = [
      {
        id: '1',
        threadId: 'test-thread-123',
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'Test message',
      },
    ];

    const contextWithoutProvider = { threadId: 'test-thread-123' };

    await expect(strategy.compact(events, contextWithoutProvider)).rejects.toThrow(
      'SummarizeCompactionStrategy requires an Agent instance or AI provider'
    );
  });

  it('should handle empty event list', async () => {
    // Test with provider fallback since agent requires more setup
    const providerContext = { threadId: 'test-thread-123', provider: mockProvider };
    const result = await strategy.compact([], providerContext);
    const compactionData = getCompactionData(result);

    expect(compactionData.originalEventCount).toBe(0);
    expect(compactionData.compactedEvents).toHaveLength(0);
    expect(compactionData.metadata?.summaryGenerated).toBe(false);
  });

  it('should work with provider fallback', async () => {
    // Test that it still works with just a provider (backward compatibility)
    const providerContext = { threadId: 'test-thread-123', provider: mockProvider };

    const events: ThreadEvent[] = [
      {
        id: '1',
        threadId: 'test-thread-123',
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'Test message',
      },
    ];

    const result = await strategy.compact(events, providerContext);
    const compactionData = getCompactionData(result);

    expect(compactionData.compactedEvents).toHaveLength(1);
    expect(compactionData.compactedEvents[0].type).toBe('LOCAL_SYSTEM_MESSAGE');
  });

  it('should skip COMPACTION events', async () => {
    const events: ThreadEvent[] = [
      {
        id: '1',
        threadId: 'test-thread-123',
        type: 'COMPACTION',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        data: {
          strategyId: 'previous-strategy',
          originalEventCount: 5,
          compactedEvents: [],
        },
      },
      {
        id: '2',
        threadId: 'test-thread-123',
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:01:00Z'),
        data: 'New message after compaction',
      },
    ];

    const result = await strategy.compact(events, context);
    const compactionData = getCompactionData(result);

    // Should only process the USER_MESSAGE, skip the COMPACTION event
    expect(compactionData.originalEventCount).toBe(2);
    expect(compactionData.compactedEvents).toHaveLength(1); // Just the summary
  });
});
