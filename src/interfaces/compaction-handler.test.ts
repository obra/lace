// ABOUTME: Tests for compaction handler and display
// ABOUTME: Verifies compaction status feedback works correctly

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CompactionHandler, ConsoleCompactionDisplay } from '~/interfaces/compaction-handler';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ToolExecutor } from '~/tools/executor';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import type { LaceEvent } from '~/threads/types';
import type { CompactionDisplay } from '~/interfaces/compaction-handler';

class MockCompactionDisplay implements CompactionDisplay {
  onCompactionStart = vi.fn();
  onCompactionComplete = vi.fn();
  onCompactionError = vi.fn();
}

// Concrete mock provider for testing
class MockProvider extends BaseMockProvider {
  constructor() {
    super({});
  }

  get providerName(): string {
    return 'mock';
  }

  createResponse = vi.fn().mockResolvedValue({
    content: 'Mock response',
    toolCalls: [],
  });
}

describe('CompactionHandler', () => {
  setupCoreTest();
  let agent: Agent;
  let threadManager: ThreadManager;
  let mockDisplay: MockCompactionDisplay;
  let handler: CompactionHandler;

  beforeEach(() => {
    threadManager = new ThreadManager();
    const threadId = threadManager.createThread();
    const provider = new MockProvider();
    const toolExecutor = new ToolExecutor();

    agent = new Agent({
      provider,
      threadManager,
      toolExecutor,
      threadId,
      tools: [],
    });

    mockDisplay = new MockCompactionDisplay();
    handler = new CompactionHandler(agent, mockDisplay);
  });

  it('should detect compaction start when /compact command is sent', () => {
    // Add /compact message to thread
    threadManager.addEvent({
      type: 'USER_MESSAGE',
      threadId: agent['_threadId'],
      data: '/compact',
    });

    // Emit thinking start
    agent.emit('agent_thinking_start');

    expect(mockDisplay.onCompactionStart).toHaveBeenCalled();
  });

  it('should not detect compaction for regular messages', () => {
    // Add regular message to thread
    threadManager.addEvent({
      type: 'USER_MESSAGE',
      threadId: agent['_threadId'],
      data: 'Hello world',
    });

    // Emit thinking start
    agent.emit('agent_thinking_start');

    expect(mockDisplay.onCompactionStart).not.toHaveBeenCalled();
  });

  it('should handle compaction complete', () => {
    // Setup compaction scenario
    threadManager.addEvent({
      type: 'USER_MESSAGE',
      threadId: agent['_threadId'],
      data: '/compact',
    });

    // Start compaction first
    agent.emit('agent_thinking_start');
    expect(mockDisplay.onCompactionStart).toHaveBeenCalled();

    // Create a compaction event
    const compactionEvent: LaceEvent = {
      id: 'evt_123',
      threadId: agent['_threadId'],
      type: 'COMPACTION',
      timestamp: new Date(),
      data: {
        strategyId: 'summarize',
        originalEventCount: 10,
        compactedEvents: [],
      },
    };
    threadManager.addEvent({
      type: 'COMPACTION',
      threadId: agent['_threadId'],
      data: compactionEvent.data,
    });

    // Complete compaction
    agent.emit('agent_thinking_complete');

    expect(mockDisplay.onCompactionComplete).toHaveBeenCalled();
  });

  it('should handle compaction errors', () => {
    // Setup compaction scenario
    threadManager.addEvent({
      type: 'USER_MESSAGE',
      threadId: agent['_threadId'],
      data: '/compact',
    });

    // Start compaction
    agent.emit('agent_thinking_start');

    // Emit error
    const error = new Error('Compaction failed');
    agent.emit('error', { error, context: { operation: 'compact' } });

    expect(mockDisplay.onCompactionStart).toHaveBeenCalled();
    expect(mockDisplay.onCompactionError).toHaveBeenCalledWith(error);
  });

  it('should cleanup event listeners', () => {
    const removeAllListenersSpy = vi.spyOn(agent, 'removeAllListeners');

    handler.cleanup();

    expect(removeAllListenersSpy).toHaveBeenCalledWith('agent_thinking_start');
    expect(removeAllListenersSpy).toHaveBeenCalledWith('agent_thinking_complete');
    expect(removeAllListenersSpy).toHaveBeenCalledWith('error');
  });
});

describe('ConsoleCompactionDisplay', () => {
  let display: ConsoleCompactionDisplay;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    display = new ConsoleCompactionDisplay();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should display compaction start message', () => {
    display.onCompactionStart();

    expect(consoleLogSpy).toHaveBeenCalledWith('\n🔄 Compacting conversation to reduce size...');
  });

  it('should display detailed compaction complete message with stats', () => {
    const compactionEvent: LaceEvent = {
      id: 'evt_123',
      threadId: 'thread_123',
      type: 'COMPACTION',
      timestamp: new Date(),
      data: {
        strategyId: 'summarize',
        originalEventCount: 100,
        compactedEvents: new Array(25) as LaceEvent[],
      },
    };

    display.onCompactionComplete(compactionEvent);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      '✅ Compaction complete! Reduced from 100 to 25 events (75% reduction)\n'
    );
  });

  it('should display simple complete message without event', () => {
    display.onCompactionComplete();

    expect(consoleLogSpy).toHaveBeenCalledWith('✅ Compaction complete!\n');
  });

  it('should display compaction error', () => {
    const error = new Error('Failed to compact');

    display.onCompactionError(error);

    expect(consoleErrorSpy).toHaveBeenCalledWith('❌ Compaction failed: Failed to compact\n');
  });
});
