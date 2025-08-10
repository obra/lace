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
          tokenUsage: {
            message: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
            thread: {
              totalPromptTokens: 100,
              totalCompletionTokens: 200,
              totalTokens: 300,
              contextLimit: 200000,
              percentUsed: 0.15,
              nearLimit: false,
            },
          },
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
    expect(compactionData.compactedEvents).toHaveLength(2); // summary + 1 user message

    // Should create a summary event first
    const summaryEvent = compactionData.compactedEvents[0];
    expect(summaryEvent.type).toBe('LOCAL_SYSTEM_MESSAGE');
    expect(summaryEvent.data).toContain('Summary of conversation about writing functions');

    // Should preserve the user message
    const userEvent = compactionData.compactedEvents[1];
    expect(userEvent.type).toBe('USER_MESSAGE');
    expect(userEvent.data).toBe('Help me write a function to calculate fibonacci numbers');
  });

  it('should preserve recent events', async () => {
    const events: ThreadEvent[] = [
      // Old events
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
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:02:00Z'),
        data: { content: 'Old response 2' },
      },
      {
        id: '4',
        threadId: 'test-thread-123',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:03:00Z'),
        data: { content: 'Old response 3' },
      },
      // Recent agent events (last 2)
      {
        id: '5',
        threadId: 'test-thread-123',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:10:00Z'),
        data: { content: 'Recent response 1' },
      },
      {
        id: '6',
        threadId: 'test-thread-123',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:11:00Z'),
        data: { content: 'Recent response 2' },
      },
    ];

    const result = await strategy.compact(events, context);
    const compactionData = getCompactionData(result);

    expect(compactionData.compactedEvents).toHaveLength(4); // summary + 1 user + 2 recent agent

    // First event should be summary
    expect(compactionData.compactedEvents[0].type).toBe('LOCAL_SYSTEM_MESSAGE');

    // Should preserve user message
    const userEvent = compactionData.compactedEvents.find((e) => e.type === 'USER_MESSAGE');
    expect(userEvent?.data).toBe('Old message 1');

    // Should preserve recent agent events
    const preservedAgentEvents = compactionData.compactedEvents.filter(
      (e) => e.type === 'AGENT_MESSAGE'
    );
    expect(preservedAgentEvents).toHaveLength(2);
    expect((preservedAgentEvents[0].data as { content: string }).content).toBe('Recent response 1');
    expect((preservedAgentEvents[1].data as { content: string }).content).toBe('Recent response 2');
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
          status: 'completed',
        },
      },
    ];

    const result = await strategy.compact(events, context);

    // Should preserve user message and summarize tool interactions
    const compactionData = getCompactionData(result);
    expect(compactionData.compactedEvents).toHaveLength(2); // summary + user message

    // First should be summary
    expect(compactionData.compactedEvents[0].type).toBe('LOCAL_SYSTEM_MESSAGE');
    expect(compactionData.compactedEvents[0].data).toContain(
      'Summary of conversation about writing functions'
    );

    // Second should be preserved user message
    expect(compactionData.compactedEvents[1].type).toBe('USER_MESSAGE');
    expect(compactionData.compactedEvents[1].data).toBe('Create a file');
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
      {
        id: '2',
        threadId: 'test-thread-123',
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: { content: 'Response to test' },
      },
    ];

    const result = await strategy.compact(events, providerContext);
    const compactionData = getCompactionData(result);

    // Should have summary + user message
    expect(compactionData.compactedEvents).toHaveLength(2);
    expect(compactionData.compactedEvents[0].type).toBe('LOCAL_SYSTEM_MESSAGE');
    expect(compactionData.compactedEvents[1].type).toBe('USER_MESSAGE');
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
      {
        id: '3',
        threadId: 'test-thread-123',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:02:00Z'),
        data: { content: 'Response' },
      },
    ];

    const result = await strategy.compact(events, context);
    const compactionData = getCompactionData(result);

    // Should only process the USER_MESSAGE and AGENT_MESSAGE, skip the COMPACTION event
    expect(compactionData.originalEventCount).toBe(3);
    expect(compactionData.compactedEvents).toHaveLength(2); // summary + user message
  });
});
