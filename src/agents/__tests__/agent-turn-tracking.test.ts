// ABOUTME: Tests for Agent turn-based progress tracking functionality
// ABOUTME: Validates turn metrics, event emissions, and timing behavior

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent, AgentConfig, CurrentTurnMetrics } from '../agent.js';
import { AIProvider } from '../../providers/base-provider.js';
import { ProviderMessage, ProviderResponse } from '../../providers/base-provider.js';
import { Tool } from '../../tools/tool.js';
import { ToolExecutor } from '../../tools/executor.js';
import { ThreadManager } from '../../threads/thread-manager.js';

// Mock provider for testing
class MockProvider extends AIProvider {
  private mockResponse: ProviderResponse;
  private delay: number;

  constructor(mockResponse: ProviderResponse, delay = 0) {
    super({});
    this.mockResponse = mockResponse;
    this.delay = delay;
  }

  get providerName(): string {
    return 'mock';
  }

  get defaultModel(): string {
    return 'mock-model';
  }

  async createResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    if (this.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delay));
    }
    return this.mockResponse;
  }
}

describe('Agent Turn Tracking', () => {
  let agent: Agent;
  let provider: MockProvider;
  let toolExecutor: ToolExecutor;
  let threadManager: ThreadManager;
  let threadId: string;

  beforeEach(async () => {
    // Create mock response without tool calls
    const mockResponse: ProviderResponse = {
      content: 'Test response',
      toolCalls: [],
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
    };

    provider = new MockProvider(mockResponse);
    toolExecutor = new ToolExecutor();
    threadManager = new ThreadManager(':memory:'); // Use in-memory SQLite for tests
    threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);

    const config: AgentConfig = {
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    };

    agent = new Agent(config);
    await agent.start();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('turn_start event', () => {
    it('should emit turn_start event when sendMessage() is called', async () => {
      // Arrange
      const turnStartEvents: Array<{
        turnId: string;
        userInput: string;
        metrics: CurrentTurnMetrics;
      }> = [];
      agent.on('turn_start', (data) => {
        turnStartEvents.push(data);
      });

      // Act
      await agent.sendMessage('Hello, world!');

      // Assert
      expect(turnStartEvents).toHaveLength(1);

      const turnStartEvent = turnStartEvents[0];
      expect(turnStartEvent.userInput).toBe('Hello, world!');
      expect(turnStartEvent.turnId).toMatch(/^turn_\d+_[a-z0-9]+$/);
      expect(turnStartEvent.metrics.turnId).toBe(turnStartEvent.turnId);
      expect(turnStartEvent.metrics.startTime).toBeInstanceOf(Date);
      expect(turnStartEvent.metrics.elapsedMs).toBe(0);
      expect(turnStartEvent.metrics.tokensIn).toBe(0);
      expect(turnStartEvent.metrics.tokensOut).toBe(0);
    });

    it('should generate unique turn IDs for each call', async () => {
      // Arrange
      const turnStartEvents: Array<{
        turnId: string;
        userInput: string;
        metrics: CurrentTurnMetrics;
      }> = [];
      agent.on('turn_start', (data) => {
        turnStartEvents.push(data);
      });

      // Act
      await agent.sendMessage('First message');
      await agent.sendMessage('Second message');

      // Assert
      expect(turnStartEvents).toHaveLength(2);
      expect(turnStartEvents[0].turnId).not.toBe(turnStartEvents[1].turnId);
      expect(turnStartEvents[0].metrics.turnId).toBe(turnStartEvents[0].turnId);
      expect(turnStartEvents[1].metrics.turnId).toBe(turnStartEvents[1].turnId);
    });
  });

  describe('turn_progress event', () => {
    it('should emit turn_progress events approximately every 1 second during processing', async () => {
      // Arrange
      vi.useFakeTimers();
      const progressEvents: Array<{ metrics: CurrentTurnMetrics }> = [];
      agent.on('turn_progress', (data) => {
        progressEvents.push(data);
      });

      // Create a provider that takes some time
      const slowProvider = new MockProvider(
        {
          content: 'Slow response',
          toolCalls: [],
        },
        3000
      ); // 3 second delay

      const slowAgent = new Agent({
        provider: slowProvider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });
      await slowAgent.start();
      slowAgent.on('turn_progress', (data) => {
        progressEvents.push(data);
      });

      // Act
      const messagePromise = slowAgent.sendMessage('Test message');

      // Advance timers to trigger progress events
      await vi.advanceTimersByTimeAsync(1000); // 1 second
      await vi.advanceTimersByTimeAsync(1000); // 2 seconds
      await vi.advanceTimersByTimeAsync(1000); // 3 seconds

      await messagePromise;

      // Assert
      expect(progressEvents.length).toBeGreaterThanOrEqual(2); // Should have at least 2 progress events

      // Check that elapsed time increases (allowing for equal values in fast tests)
      for (let i = 1; i < progressEvents.length; i++) {
        expect(progressEvents[i].metrics.elapsedMs).toBeGreaterThanOrEqual(
          progressEvents[i - 1].metrics.elapsedMs
        );
      }
    });
  });

  describe('turn_complete event', () => {
    it('should emit turn_complete event with correct metrics when processing finishes', async () => {
      // Arrange
      const completeEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];
      agent.on('turn_complete', (data) => {
        completeEvents.push(data);
      });

      // Act
      await agent.sendMessage('Test message');

      // Assert
      expect(completeEvents).toHaveLength(1);

      const completeEvent = completeEvents[0];
      expect(completeEvent.turnId).toMatch(/^turn_\d+_[a-z0-9]+$/);
      expect(completeEvent.metrics.turnId).toBe(completeEvent.turnId);
      expect(completeEvent.metrics.elapsedMs).toBeGreaterThan(0);
      expect(completeEvent.metrics.startTime).toBeInstanceOf(Date);
    });
  });

  describe('turn metrics reset', () => {
    it('should reset turn metrics on each new user input', async () => {
      // Arrange
      const startEvents: Array<{ turnId: string; userInput: string; metrics: CurrentTurnMetrics }> =
        [];
      agent.on('turn_start', (data) => {
        startEvents.push(data);
      });

      // Act
      await agent.sendMessage('First message');
      await agent.sendMessage('Second message');

      // Assert
      expect(startEvents).toHaveLength(2);

      // Each turn should start with fresh metrics
      expect(startEvents[0].metrics.elapsedMs).toBe(0);
      expect(startEvents[1].metrics.elapsedMs).toBe(0);
      expect(startEvents[0].metrics.tokensIn).toBe(0);
      expect(startEvents[1].metrics.tokensIn).toBe(0);
      expect(startEvents[0].metrics.tokensOut).toBe(0);
      expect(startEvents[1].metrics.tokensOut).toBe(0);
    });
  });
});
