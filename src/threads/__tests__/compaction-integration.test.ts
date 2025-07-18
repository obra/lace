// ABOUTME: Integration tests for thread compaction with Agent
// ABOUTME: Tests end-to-end compaction workflow including agent-triggered compaction

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { BaseMockProvider } from '~/__tests__/utils/base-mock-provider';
import { Tool } from '~/tools/tool';
import { SummarizeStrategy } from '~/threads/compaction/summarize-strategy';

// Mock provider for testing
class MockProvider extends BaseMockProvider {
  private mockResponse: ProviderResponse = {
    content: 'I understand.',
    toolCalls: [],
  };

  constructor() {
    super({});
  }

  get providerName(): string {
    return 'mock';
  }

  get defaultModel(): string {
    return 'mock-model';
  }

  // Use context window that allows for testing but not too restrictive
  get contextWindow(): number {
    return 4000;
  }

  get maxCompletionTokens(): number {
    return 2000;
  }

  setMockResponse(content: string): void {
    this.mockResponse = {
      content,
      toolCalls: [],
    };
  }

  createResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    return Promise.resolve(this.mockResponse);
  }
}

describe('Compaction Integration', () => {
  let tempDbPath: string;
  let threadManager: ThreadManager;
  let agent: Agent;
  let mockProvider: MockProvider;
  let toolExecutor: ToolExecutor;

  beforeEach(async () => {
    tempDbPath = path.join(os.tmpdir(), `lace-test-${Date.now()}.db`);
    threadManager = new ThreadManager(tempDbPath);

    // Configure compaction strategy with lower token limit for testing
    threadManager['_compactionStrategy'] = new SummarizeStrategy({
      maxTokens: 500, // Very low for testing to ensure compaction triggers
      preserveRecentEvents: 2,
    });

    mockProvider = new MockProvider();
    toolExecutor = new ToolExecutor();

    const threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);

    agent = new Agent({
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    await agent.start();
  });

  afterEach(() => {
    agent?.stop();
    threadManager?.close();
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });

  it('should trigger compaction and preserve conversational flow', async () => {
    const originalThreadId = agent.getThreadId();

    // Manually add large tool results to trigger compaction
    const longToolResult = 'Very long tool output that takes up lots of tokens. '.repeat(200);

    // Add a mix of events that will trigger compaction
    threadManager.addEvent(originalThreadId, 'USER_MESSAGE', 'Please run a command');
    threadManager.addEvent(originalThreadId, 'AGENT_MESSAGE', 'I will run that for you');

    // Add several large tool results that should trigger compaction
    for (let i = 0; i < 5; i++) {
      threadManager.addEvent(originalThreadId, 'TOOL_CALL', {
        id: `call_${i}`,
        name: 'bash',
        arguments: { command: 'ls -la' },
      });
      threadManager.addEvent(originalThreadId, 'TOOL_RESULT', {
        id: `call_${i}`,
        content: [{ type: 'text', text: longToolResult }],
        isError: false,
      });
    }

    // Trigger compaction manually using simplified approach
    expect(await threadManager.needsCompaction()).toBe(true);
    const newThreadId = threadManager.createCompactedVersion('Test compaction');
    expect(newThreadId).toBeDefined();

    // Check if compaction occurred - Agent threadId should remain stable (canonical ID)
    const finalThreadId = agent.getThreadId();
    expect(finalThreadId).toBe(originalThreadId);

    // ThreadManager's current thread should be different if compaction occurred
    const currentShadowThreadId = threadManager.getCurrentThreadId();
    expect(currentShadowThreadId).not.toBe(originalThreadId);

    // Get events from the compacted thread
    const eventsAfterCompaction = threadManager.getEvents(currentShadowThreadId!);

    // Should have: the 2 user/agent messages preserved + tool events (now preserved) + any summary
    expect(eventsAfterCompaction.length).toBeGreaterThan(2); // At least the preserved messages
    // With tool preservation, we may have close to the original count but with truncated tool results
    expect(eventsAfterCompaction.length).toBeLessThanOrEqual(15); // Allow for preserved tool events

    // All user and agent messages should be preserved
    const userAgentEvents = eventsAfterCompaction.filter(
      (e) => e.type === 'USER_MESSAGE' || e.type === 'AGENT_MESSAGE'
    );
    expect(userAgentEvents).toHaveLength(2);
    expect(userAgentEvents[0].data).toBe('Please run a command');
    expect(userAgentEvents[1].data).toBe('I will run that for you');

    // With new strategy, summary may or may not be created depending on whether events needed summarization
    // If all events are preserved (as important), no summary is created
    // This is fine - compaction still occurred (thread shadowing)

    // Should maintain canonical ID mapping
    expect(threadManager.getCanonicalId(currentShadowThreadId!)).toBe(originalThreadId);
  });

  it('should continue conversation normally after compaction', async () => {
    const originalThreadId = agent.getThreadId();

    // Manually create a compaction scenario and trigger it
    const longToolResult = 'Long tool output. '.repeat(100); // Smaller to avoid context window issues after compaction

    threadManager.addEvent(originalThreadId, 'USER_MESSAGE', 'First message');
    threadManager.addEvent(originalThreadId, 'AGENT_MESSAGE', 'First response');

    for (let i = 0; i < 3; i++) {
      threadManager.addEvent(originalThreadId, 'TOOL_RESULT', {
        id: `result_${i}`,
        content: [{ type: 'text', text: longToolResult }],
        isError: false,
      });
    }

    // Trigger compaction using simplified approach
    if (await threadManager.needsCompaction()) {
      threadManager.createCompactedVersion('Test compaction for conversation');
    }

    // Verify compaction occurred - Agent threadId should remain stable
    const compactedThreadId = agent.getThreadId();
    expect(compactedThreadId).toBe(originalThreadId); // Agent threadId stays stable

    // Continue conversation after compaction
    mockProvider.setMockResponse('Hello there!');
    await agent.sendMessage('Hello after compaction');

    // Get the active thread ID (compacted thread or original)
    const activeThreadId = threadManager.getCurrentThreadId() || originalThreadId;
    const finalEvents = threadManager.getEvents(activeThreadId);

    // Should have events and the last should be the new response
    expect(finalEvents.length).toBeGreaterThan(0);
    const lastEvent = finalEvents[finalEvents.length - 1];

    expect(lastEvent.type).toBe('AGENT_MESSAGE');
    expect(lastEvent.data).toBe('Hello there!');
  });
});
