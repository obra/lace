// ABOUTME: Tests for enhanced AI summarization features in Phase 3
// ABOUTME: Validates user message preservation and metadata tracking

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SummarizeCompactionStrategy } from '~/threads/compaction/summarize-strategy';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import type { LaceEvent } from '~/threads/types';
import type { CompactionContext, CompactionData } from '~/threads/compaction/types';

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

// Helper to cast result data to CompactionData
function getCompactionData(result: LaceEvent): CompactionData {
  return result.data as CompactionData;
}

describe('Enhanced SummarizeCompactionStrategy (Phase 3)', () => {
  setupCoreTest();
  let strategy: SummarizeCompactionStrategy;
  let agent: Agent;
  let threadManager: ThreadManager;
  let context: CompactionContext;

  beforeEach(() => {
    strategy = new SummarizeCompactionStrategy();
    threadManager = new ThreadManager();
    const threadId = threadManager.createThread();

    const mockProvider = new MockSummarizationProvider(
      'Summary: User is building a TODO app with React'
    );

    const toolExecutor = new ToolExecutor();

    agent = new Agent({
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    context = {
      threadId,
      agent,
    };
  });

  it('should preserve ALL user messages', async () => {
    const events: LaceEvent[] = [
      // Many user messages
      {
        id: '1',
        threadId: context.threadId,
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        data: 'User message 1',
      },
      {
        id: '2',
        threadId: context.threadId,
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:01:00Z'),
        data: 'User message 2',
      },
      {
        id: '3',
        threadId: context.threadId,
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:02:00Z'),
        data: 'User message 3',
      },
      {
        id: '4',
        threadId: context.threadId,
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:03:00Z'),
        data: 'User message 4',
      },
      {
        id: '5',
        threadId: context.threadId,
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:04:00Z'),
        data: 'User message 5',
      },
      // Some agent responses
      {
        id: '6',
        threadId: context.threadId,
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:05:00Z'),
        data: { content: 'Response 1' },
      },
      {
        id: '7',
        threadId: context.threadId,
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:06:00Z'),
        data: { content: 'Response 2' },
      },
    ];

    const result = await strategy.compact(events, context);
    const compactionData = getCompactionData(result);

    // Should preserve ALL user messages
    const preservedUserMessages = compactionData.compactedEvents
      .filter((e) => e.type === 'USER_MESSAGE')
      .map((e) => e.data);

    expect(preservedUserMessages).toHaveLength(5);
    expect(preservedUserMessages).toContain('User message 1');
    expect(preservedUserMessages).toContain('User message 2');
    expect(preservedUserMessages).toContain('User message 3');
    expect(preservedUserMessages).toContain('User message 4');
    expect(preservedUserMessages).toContain('User message 5');

    // Check metadata
    expect(compactionData.metadata?.preservedUserMessages).toBe(5);
  });

  it('should summarize old agent messages but keep recent ones', async () => {
    const events: LaceEvent[] = [
      {
        id: '1',
        threadId: context.threadId,
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        data: 'Request 1',
      },
      // Old agent messages (should be summarized)
      {
        id: '2',
        threadId: context.threadId,
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:01:00Z'),
        data: { content: 'Old response 1' },
      },
      {
        id: '3',
        threadId: context.threadId,
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:02:00Z'),
        data: { content: 'Old response 2' },
      },
      {
        id: '4',
        threadId: context.threadId,
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:03:00Z'),
        data: { content: 'Old response 3' },
      },
      // Recent agent messages (should be preserved)
      {
        id: '5',
        threadId: context.threadId,
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:04:00Z'),
        data: { content: 'Recent response 1' },
      },
      {
        id: '6',
        threadId: context.threadId,
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:05:00Z'),
        data: { content: 'Recent response 2' },
      },
    ];

    const result = await strategy.compact(events, context);
    const compactionData = getCompactionData(result);

    // Should have summary + user message + 2 recent agent messages
    const agentMessages = compactionData.compactedEvents.filter((e) => e.type === 'AGENT_MESSAGE');

    // Recent messages should be preserved
    const hasRecentResponse1 = agentMessages.some(
      (e) => (e.data as { content: string }).content === 'Recent response 1'
    );
    const hasRecentResponse2 = agentMessages.some(
      (e) => (e.data as { content: string }).content === 'Recent response 2'
    );

    expect(hasRecentResponse1).toBe(true);
    expect(hasRecentResponse2).toBe(true);

    // Old messages should NOT be preserved as individual events
    const hasOldResponse1 = agentMessages.some(
      (e) => (e.data as { content: string }).content === 'Old response 1'
    );
    expect(hasOldResponse1).toBe(false);
  });

  it('should track summary length in metadata', async () => {
    const mockSummary =
      'This is a detailed summary of the conversation about building a TODO app with React and TypeScript';

    const mockProvider = new MockSummarizationProvider(mockSummary);

    const toolExecutor = new ToolExecutor();
    const threadId = threadManager.createThread();

    agent = new Agent({
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    context = {
      threadId,
      agent,
    };

    const events: LaceEvent[] = [
      {
        id: '1',
        threadId: context.threadId,
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'Build something',
      },
      {
        id: '2',
        threadId: context.threadId,
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: { content: 'I will build it' },
      },
    ];

    const result = await strategy.compact(events, context);
    const compactionData = getCompactionData(result);

    // Check that summary is in metadata
    expect(compactionData.metadata?.summary).toBe(mockSummary);
  });

  it('should not duplicate events when preserving user messages', async () => {
    const events: LaceEvent[] = [
      {
        id: '1',
        threadId: context.threadId,
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        data: 'Old message',
      },
      {
        id: '2',
        threadId: context.threadId,
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:01:00Z'),
        data: 'Recent message 1',
      },
      {
        id: '3',
        threadId: context.threadId,
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:02:00Z'),
        data: 'Recent message 2',
      },
      {
        id: '4',
        threadId: context.threadId,
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:03:00Z'),
        data: { content: 'Response' },
      },
    ];

    const result = await strategy.compact(events, context);
    const compactionData = getCompactionData(result);

    // Count occurrences of each message
    const messageCounts = new Map<string, number>();
    for (const event of compactionData.compactedEvents) {
      if (event.type === 'USER_MESSAGE') {
        const data = event.data;
        messageCounts.set(data, (messageCounts.get(data) || 0) + 1);
      }
    }

    // Each message should appear at most once
    for (const count of messageCounts.values()) {
      expect(count).toBe(1);
    }
  });

  it('should include all enhanced metadata fields', async () => {
    const events: LaceEvent[] = [
      {
        id: '1',
        threadId: context.threadId,
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'User message',
      },
      {
        id: '2',
        threadId: context.threadId,
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: { content: 'Agent response' },
      },
    ];

    const result = await strategy.compact(events, context);
    const compactionData = getCompactionData(result);

    // Should have all metadata fields
    expect(compactionData.metadata).toBeDefined();
    expect(compactionData.metadata?.summary).toBeDefined();
    expect(compactionData.metadata?.recentEventCount).toBe(2);
    expect(compactionData.metadata?.strategy).toBe('ai-powered-summarization');
    expect(compactionData.metadata?.preservedUserMessages).toBe(1);
  });
});
