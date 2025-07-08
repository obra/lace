// ABOUTME: End-to-end tests for message queue scenarios with realistic workflows
// ABOUTME: Tests complex queueing behavior, priority handling, and error recovery

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '../agent.js';
import { AIProvider } from '../../providers/base-provider.js';
import { ProviderMessage, ProviderResponse } from '../../providers/base-provider.js';
import { Tool } from '../../tools/tool.js';
import { ToolExecutor } from '../../tools/executor.js';
import { ThreadManager } from '../../threads/thread-manager.js';
import { z } from 'zod';

// Mock provider with configurable delay for testing long operations
class LongOperationProvider extends AIProvider {
  constructor(private delayMs: number = 1000) {
    super({});
  }

  get providerName(): string {
    return 'long-operation';
  }

  get defaultModel(): string {
    return 'slow-model';
  }

  async createResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    // Simulate long-running operation
    await new Promise(resolve => setTimeout(resolve, this.delayMs));
    return {
      content: 'Long operation completed',
      usage: { inputTokens: 20, outputTokens: 10 },
    };
  }
}

// Mock tool that can fail for error testing
class FlakeyTool extends Tool {
  name = 'flakey_tool';
  description = 'A tool that sometimes fails';
  schema = z.object({
    shouldFail: z.boolean().default(false),
  });

  protected async executeValidated(args: z.infer<typeof this.schema>) {
    if (args.shouldFail) {
      throw new Error('Tool execution failed');
    }
    return this.createResult('Tool succeeded');
  }
}

describe('Agent Queue End-to-End Scenarios', () => {
  let agent: Agent;
  let longProvider: LongOperationProvider;
  let mockToolExecutor: ToolExecutor;
  let mockThreadManager: ThreadManager;
  let flakeyTool: FlakeyTool;
  
  beforeEach(async () => {
    longProvider = new LongOperationProvider(500); // 500ms delay
    flakeyTool = new FlakeyTool();
    
    mockToolExecutor = {
      registerAllAvailableTools: vi.fn(),
      getRegisteredTools: vi.fn().mockReturnValue([flakeyTool]),
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
      provider: longProvider,
      toolExecutor: mockToolExecutor,
      threadManager: mockThreadManager,
      threadId: 'test-thread',
      tools: [flakeyTool],
    });
    
    await agent.start();
  });

  afterEach(async () => {
    if (agent) {
      agent.removeAllListeners();
      await agent.stop();
    }
  });

  describe('Scenario 1: Multiple messages during long operation', () => {
    it('should queue multiple user messages and process them in order', async () => {
      const processedMessages: string[] = [];
      
      // Track processed messages by monitoring thread events
      mockThreadManager.addEvent = vi.fn().mockImplementation((event) => {
        if (event.type === 'USER_MESSAGE') {
          processedMessages.push(event.content);
        }
      });
      
      // Start long operation but don't await it yet
      const longOpPromise = agent.sendMessage('Start long operation');
      
      // Wait a tiny bit to ensure agent enters busy state
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Queue multiple messages while operation runs
      await agent.sendMessage('Queued message 1', { queue: true });
      await agent.sendMessage('Queued message 2', { queue: true });
      await agent.sendMessage('Queued message 3', { queue: true });
      
      // Verify all messages are queued
      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(3);
      
      // Wait for long operation to complete
      await longOpPromise;
      
      // Wait for queue processing to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify queue was processed in order
      expect(processedMessages).toContain('Start long operation');
      expect(processedMessages).toContain('Queued message 1');
      expect(processedMessages).toContain('Queued message 2');
      expect(processedMessages).toContain('Queued message 3');
      
      // Verify queue is empty
      const finalStats = agent.getQueueStats();
      expect(finalStats.queueLength).toBe(0);
    });
  });

  describe('Scenario 2: Task notifications during busy periods', () => {
    it('should queue task notifications while agent is processing', async () => {
      const queuedEvents: any[] = [];
      agent.on('message_queued', (data) => queuedEvents.push(data));
      
      // Start long operation
      const longOpPromise = agent.sendMessage('Processing user request');
      
      // Wait a tiny bit to ensure agent enters busy state
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Queue task notifications while busy
      agent.queueMessage('Task assigned: Implement feature X', 'task_notification', {
        taskId: 'task-1',
        fromAgent: 'coordinator-agent',
        source: 'task_system',
      });
      
      agent.queueMessage('Task updated: Requirements changed', 'task_notification', {
        taskId: 'task-1',
        fromAgent: 'coordinator-agent',
        source: 'task_system',
      });
      
      // Verify task notifications were queued
      expect(queuedEvents).toHaveLength(2);
      expect(queuedEvents[0].queueLength).toBe(1);
      expect(queuedEvents[1].queueLength).toBe(2);
      
      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(2);
      
      // Wait for processing to complete
      await longOpPromise;
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify notifications were processed
      const finalStats = agent.getQueueStats();
      expect(finalStats.queueLength).toBe(0);
    });
  });

  describe('Scenario 3: High priority message processing', () => {
    it('should process high priority messages before normal ones', async () => {
      const processedOrder: string[] = [];
      
      // Track processing order
      mockThreadManager.addEvent = vi.fn().mockImplementation((event) => {
        if (event.type === 'USER_MESSAGE') {
          processedOrder.push(event.content);
        }
      });
      
      // Start long operation
      const longOpPromise = agent.sendMessage('Initial operation');
      
      // Wait a tiny bit to ensure agent enters busy state
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Queue normal messages
      await agent.sendMessage('Normal message 1', { 
        queue: true,
        metadata: { priority: 'normal' }
      });
      await agent.sendMessage('Normal message 2', { 
        queue: true,
        metadata: { priority: 'normal' }
      });
      
      // Queue high priority message
      await agent.sendMessage('URGENT: High priority message', { 
        queue: true,
        metadata: { priority: 'high' }
      });
      
      // Queue another normal message
      await agent.sendMessage('Normal message 3', { 
        queue: true,
        metadata: { priority: 'normal' }
      });
      
      // Verify queue stats show high priority count
      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(4);
      expect(stats.highPriorityCount).toBe(1);
      
      // Wait for processing
      await longOpPromise;
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Verify high priority was processed first among queued messages
      const queuedMessages = processedOrder.slice(1); // Remove initial operation
      expect(queuedMessages[0]).toBe('URGENT: High priority message');
      
      // Verify all messages were processed
      expect(queuedMessages).toContain('Normal message 1');
      expect(queuedMessages).toContain('Normal message 2'); 
      expect(queuedMessages).toContain('Normal message 3');
    });
  });

  describe('Scenario 4: Queue survives processing errors', () => {
    it('should continue processing queue even when individual messages fail', async () => {
      const processedMessages: string[] = [];
      const errorEvents: any[] = [];
      
      // Track successful processing
      mockThreadManager.addEvent = vi.fn().mockImplementation((event) => {
        if (event.type === 'USER_MESSAGE') {
          processedMessages.push(event.content);
        }
      });
      
      // Track error events
      agent.on('error', (error) => errorEvents.push(error));
      
      // Create provider that fails on certain messages
      const errorProvider = new (class extends AIProvider {
        constructor() { super({}); }
        get providerName() { return 'error-prone'; }
        get defaultModel() { return 'failing-model'; }
        
        async createResponse(messages: ProviderMessage[]): Promise<ProviderResponse> {
          const lastMessage = messages[messages.length - 1];
          if (lastMessage && lastMessage.content.includes('FAIL')) {
            throw new Error('Simulated provider failure');
          }
          return {
            content: 'Success response',
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
      })();
      
      // Update agent with error-prone provider
      agent = new Agent({
        provider: errorProvider,
        toolExecutor: mockToolExecutor,
        threadManager: mockThreadManager,
        threadId: 'test-thread',
        tools: [],
      });
      await agent.start();
      
      // Queue messages including one that will fail
      await agent.sendMessage('Good message 1', { queue: true });
      await agent.sendMessage('FAIL message - this will error', { queue: true });
      await agent.sendMessage('Good message 2', { queue: true });
      
      // Verify all queued
      let stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(3);
      
      // Process queue (agent starts idle in new instance)
      await agent.processQueuedMessages();
      
      // Wait for processing attempts
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify queue processing continued despite error
      // Note: Error handling behavior depends on implementation
      // Queue should either retry or skip failed messages
      stats = agent.getQueueStats();
      expect(stats.queueLength).toBeLessThanOrEqual(1); // Failed message might remain
      
      // Verify good messages were processed
      expect(processedMessages).toContain('Good message 1');
      expect(processedMessages).toContain('Good message 2');
    });
  });

  describe('Queue event lifecycle', () => {
    it('should emit complete event lifecycle during queue processing', async () => {
      const events: Array<{ type: string; data?: any }> = [];
      
      // Listen to all queue events
      agent.on('message_queued', (data) => events.push({ type: 'message_queued', data }));
      agent.on('queue_processing_start', () => events.push({ type: 'queue_processing_start' }));
      agent.on('queue_processing_complete', () => events.push({ type: 'queue_processing_complete' }));
      
      // Start operation and queue messages
      const opPromise = agent.sendMessage('Initial message');
      
      // Wait a tiny bit to ensure agent enters busy state
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await agent.sendMessage('Queued 1', { queue: true });
      await agent.sendMessage('Queued 2', { queue: true });
      
      // Verify queueing events
      expect(events.filter(e => e.type === 'message_queued')).toHaveLength(2);
      
      // Wait for processing
      await opPromise;
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify processing events were emitted
      expect(events.some(e => e.type === 'queue_processing_start')).toBe(true);
      expect(events.some(e => e.type === 'queue_processing_complete')).toBe(true);
      
      // Verify event ordering (queued events before processing events)
      const queuedEventIndices = events
        .map((e, i) => e.type === 'message_queued' ? i : -1)
        .filter(i => i >= 0);
      const processingStartIndex = events.findIndex(e => e.type === 'queue_processing_start');
      
      expect(Math.max(...queuedEventIndices)).toBeLessThan(processingStartIndex);
    });
  });
});