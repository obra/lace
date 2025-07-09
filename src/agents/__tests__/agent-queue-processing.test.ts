// ABOUTME: Tests for automatic queue processing on state transitions
// ABOUTME: Ensures messages are processed when agent returns to idle

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '../agent.js';
import { AIProvider } from '../../providers/base-provider.js';
import { ProviderMessage, ProviderResponse } from '../../providers/base-provider.js';
import { Tool } from '../../tools/tool.js';
import { ToolExecutor } from '../../tools/executor.js';
import { ThreadManager } from '../../threads/thread-manager.js';

// Mock provider for testing
class MockProvider extends AIProvider {
  constructor() {
    super({});
  }

  get providerName(): string {
    return 'mock';
  }

  get defaultModel(): string {
    return 'mock-model';
  }

  async createResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    return {
      content: 'mock response',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    };
  }
}

describe('Agent Queue Processing', () => {
  let agent: Agent;
  let mockProvider: MockProvider;
  let mockToolExecutor: ToolExecutor;
  let mockThreadManager: ThreadManager;

  beforeEach(() => {
    mockProvider = new MockProvider();
    mockToolExecutor = {
      registerAllAvailableTools: vi.fn(),
      getRegisteredTools: vi.fn().mockReturnValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    } as any;
    mockThreadManager = {
      addEvent: vi.fn(),
      getEvents: vi.fn().mockReturnValue([]),
      getSessionInfo: vi.fn().mockReturnValue({
        threadId: 'test-thread',
        model: 'test-model',
        provider: 'test-provider',
      }),
      getCurrentThreadId: vi.fn().mockReturnValue('test-thread'),
      needsCompaction: vi.fn().mockResolvedValue(false),
      createCompactedVersion: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as any;
    
    agent = new Agent({
      provider: mockProvider,
      toolExecutor: mockToolExecutor,
      threadManager: mockThreadManager,
      threadId: 'test-thread',
      tools: [],
    });
  });

  describe('processQueuedMessages', () => {
    it('should process queued messages when returning to idle', async () => {
      // Queue a message
      agent.queueMessage('test message');
      
      // Verify message is queued
      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(1);
      
      // Mock _processMessage to track calls
      const processMessageSpy = vi.spyOn(agent as any, '_processMessage');
      processMessageSpy.mockImplementation(async () => {});
      
      // Process queue should be called when state becomes idle
      await agent.processQueuedMessages();
      
      // Verify message was processed
      expect(processMessageSpy).toHaveBeenCalledWith('test message');
      
      const finalStats = agent.getQueueStats();
      expect(finalStats.queueLength).toBe(0);
    });

    it('should process messages in correct order (high priority first)', async () => {
      // Queue messages with different priorities
      agent.queueMessage('normal 1');
      agent.queueMessage('high priority', 'user', { priority: 'high' });
      agent.queueMessage('normal 2');
      
      const processedMessages: string[] = [];
      const processMessageSpy = vi.spyOn(agent as any, '_processMessage');
      processMessageSpy.mockImplementation(async (...args: any[]) => {
        processedMessages.push(args[0] as string);
        return;
      });
      
      await agent.processQueuedMessages();
      
      // High priority should be processed first
      expect(processedMessages).toEqual(['high priority', 'normal 1', 'normal 2']);
    });

    it('should not process queue recursively', async () => {
      agent.queueMessage('test message');
      
      let processCallCount = 0;
      const processQueueSpy = vi.spyOn(agent, 'processQueuedMessages');
      processQueueSpy.mockImplementation(async () => {
        processCallCount++;
        if (processCallCount === 1) {
          // First call should not trigger another call
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      });
      
      await agent.processQueuedMessages();
      
      expect(processCallCount).toBe(1);
    });

    it('should handle errors in message processing gracefully', async () => {
      agent.queueMessage('message 1');
      agent.queueMessage('message 2');
      
      const processMessageSpy = vi.spyOn(agent as any, '_processMessage');
      processMessageSpy.mockImplementation(async (content) => {
        if (content === 'message 1') {
          throw new Error('Processing failed');
        }
      });
      
      // Should not throw and should continue processing
      await expect(agent.processQueuedMessages()).resolves.not.toThrow();
      
      // Should have attempted both messages
      expect(processMessageSpy).toHaveBeenCalledTimes(2);
      expect(processMessageSpy).toHaveBeenCalledWith('message 1');
      expect(processMessageSpy).toHaveBeenCalledWith('message 2');
    });

    it('should emit queue processing events', async () => {
      agent.queueMessage('test message');
      
      const processingStartEvents: any[] = [];
      const processingCompleteEvents: any[] = [];
      
      agent.on('queue_processing_start' as any, (data: any) => {
        processingStartEvents.push(data);
      });
      agent.on('queue_processing_complete' as any, (data: any) => {
        processingCompleteEvents.push(data);
      });
      
      const processMessageSpy = vi.spyOn(agent as any, '_processMessage');
      processMessageSpy.mockImplementation(async () => {});
      
      await agent.processQueuedMessages();
      
      expect(processingStartEvents).toHaveLength(1);
      expect(processingCompleteEvents).toHaveLength(1);
    });
  });

  describe('state transitions', () => {
    it('should trigger queue processing when state becomes idle', () => {
      agent.queueMessage('test message');
      
      const processQueueSpy = vi.spyOn(agent, 'processQueuedMessages');
      processQueueSpy.mockImplementation(async () => {});
      
      // First set to non-idle state, then to idle to trigger the transition
      (agent as any)._setState('thinking');
      (agent as any)._setState('idle');
      
      expect(processQueueSpy).toHaveBeenCalled();
    });

    it('should not trigger queue processing for non-idle states', () => {
      agent.queueMessage('test message');
      
      const processQueueSpy = vi.spyOn(agent, 'processQueuedMessages');
      processQueueSpy.mockImplementation(async () => {});
      
      // Reset call count
      processQueueSpy.mockClear();
      
      // Simulate state changes to non-idle states
      (agent as any)._setState('thinking');
      (agent as any)._setState('streaming');
      (agent as any)._setState('tool_execution');
      
      expect(processQueueSpy).not.toHaveBeenCalled();
    });
  });
});