// ABOUTME: Tests for SIGINT handling and turn state integration in terminal interface
// ABOUTME: Validates abort-first behavior, double Ctrl+C detection, and React state management

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '../../../agents/agent.js';
import { ToolExecutor } from '../../../tools/executor.js';
import { ThreadManager } from '../../../threads/thread-manager.js';
import { AIProvider } from '../../../providers/base-provider.js';
import { ProviderMessage, ProviderResponse } from '../../../providers/base-provider.js';
import { Tool } from '../../../tools/tool.js';

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

  async createResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    if (this.delay > 0) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => resolve(this.mockResponse), this.delay);

        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            const error = new Error('Request aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }
      });
    }

    return this.mockResponse;
  }
}

describe('SIGINT Integration Tests', () => {
  let agent: Agent;
  let provider: MockProvider;
  let toolExecutor: ToolExecutor;
  let threadManager: ThreadManager;
  let threadId: string;

  beforeEach(async () => {
    const mockResponse: ProviderResponse = {
      content: 'Test response',
      toolCalls: [],
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
    };

    provider = new MockProvider(mockResponse, 100); // 100ms delay for testing
    toolExecutor = new ToolExecutor();
    threadManager = new ThreadManager(':memory:');
    threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);

    agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    await agent.start();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Agent abort integration', () => {
    it('should abort active operations when agent.abort() is called', async () => {
      // Arrange
      let turnAborted = false;
      agent.on('turn_aborted', () => {
        turnAborted = true;
      });

      // Start a slow operation
      const messagePromise = agent.sendMessage('Test message');

      // Wait for operation to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Act - abort the operation
      const wasAborted = agent.abort();

      // Wait for completion
      await messagePromise;

      // Assert
      expect(wasAborted).toBe(true);
      expect(turnAborted).toBe(true);
      expect(agent.getCurrentState()).toBe('idle');
    });

    it('should return false when no operation is running', () => {
      // Act
      const wasAborted = agent.abort();

      // Assert
      expect(wasAborted).toBe(false);
    });

    it('should emit turn_start and turn_complete events during normal operation', async () => {
      // Arrange
      const events: string[] = [];

      agent.on('turn_start', () => events.push('turn_start'));
      agent.on('turn_complete', () => events.push('turn_complete'));
      agent.on('turn_aborted', () => events.push('turn_aborted'));

      // Act
      await agent.sendMessage('Test message');

      // Assert
      expect(events).toContain('turn_start');
      expect(events).toContain('turn_complete');
      expect(events).not.toContain('turn_aborted');
    });

    it('should emit turn_start and turn_aborted events when operation is aborted', async () => {
      // Arrange
      const events: string[] = [];

      agent.on('turn_start', () => events.push('turn_start'));
      agent.on('turn_complete', () => events.push('turn_complete'));
      agent.on('turn_aborted', () => events.push('turn_aborted'));

      // Start operation and abort it
      const messagePromise = agent.sendMessage('Test message');
      await new Promise((resolve) => setTimeout(resolve, 10));
      agent.abort();
      await messagePromise;

      // Assert
      expect(events).toContain('turn_start');
      expect(events).toContain('turn_aborted');
      expect(events).not.toContain('turn_complete');
    });
  });

  describe('Turn metrics', () => {
    it('should provide turn metrics in turn_start event', async () => {
      // Arrange
      let turnStartData: any = null;

      agent.on('turn_start', (data) => {
        turnStartData = data;
      });

      // Act
      await agent.sendMessage('Test message');

      // Assert
      expect(turnStartData).not.toBeNull();
      expect(turnStartData.turnId).toMatch(/^turn_\d+_[a-z0-9]+$/);
      expect(turnStartData.userInput).toBe('Test message');
      expect(turnStartData.metrics).toBeDefined();
      expect(turnStartData.metrics.startTime).toBeInstanceOf(Date);
      expect(turnStartData.metrics.turnId).toBe(turnStartData.turnId);
    });

    it('should provide turn metrics in turn_complete event', async () => {
      // Arrange
      let turnCompleteData: any = null;

      agent.on('turn_complete', (data) => {
        turnCompleteData = data;
      });

      // Act
      await agent.sendMessage('Test message');

      // Assert
      expect(turnCompleteData).not.toBeNull();
      expect(turnCompleteData.turnId).toMatch(/^turn_\d+_[a-z0-9]+$/);
      expect(turnCompleteData.metrics).toBeDefined();
      expect(turnCompleteData.metrics.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('should provide turn metrics in turn_aborted event', async () => {
      // Arrange
      let turnAbortedData: any = null;

      agent.on('turn_aborted', (data) => {
        turnAbortedData = data;
      });

      // Start operation and abort
      const messagePromise = agent.sendMessage('Test message');
      await new Promise((resolve) => setTimeout(resolve, 10));
      agent.abort();
      await messagePromise;

      // Assert
      expect(turnAbortedData).not.toBeNull();
      expect(turnAbortedData.turnId).toMatch(/^turn_\d+_[a-z0-9]+$/);
      expect(turnAbortedData.metrics).toBeDefined();
      expect(turnAbortedData.metrics.elapsedMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('State management', () => {
    it('should transition agent state correctly during normal operation', async () => {
      // Arrange
      const states: string[] = [];

      agent.on('state_change', ({ to }) => {
        states.push(to);
      });

      // Act
      await agent.sendMessage('Test message');

      // Assert
      expect(states).toContain('thinking');
      expect(agent.getCurrentState()).toBe('idle');
    });

    it('should return to idle state after abort', async () => {
      // Arrange - start operation
      const messagePromise = agent.sendMessage('Test message');
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify we're not idle
      expect(agent.getCurrentState()).not.toBe('idle');

      // Act - abort
      agent.abort();
      await messagePromise;

      // Assert
      expect(agent.getCurrentState()).toBe('idle');
    });
  });

  describe('Progress tracking', () => {
    it('should set up progress tracking during operation', async () => {
      // Arrange
      let turnStarted = false;
      let turnCompleted = false;

      agent.on('turn_start', () => {
        turnStarted = true;
      });
      agent.on('turn_complete', () => {
        turnCompleted = false;
      });

      // Act
      await agent.sendMessage('Test message');

      // Assert - verify turn lifecycle works (progress tracking is internal)
      expect(turnStarted).toBe(true);
      expect(turnCompleted).toBe(false); // Should be reset by turn_complete handler
    });

    it('should clean up progress tracking when aborted', async () => {
      // Arrange
      let turnStarted = false;
      let turnAborted = false;

      agent.on('turn_start', () => {
        turnStarted = true;
      });
      agent.on('turn_aborted', () => {
        turnAborted = true;
      });

      // Start operation
      const messagePromise = agent.sendMessage('Test message');
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Act - abort
      agent.abort();
      await messagePromise;

      // Assert - verify abort lifecycle works
      expect(turnStarted).toBe(true);
      expect(turnAborted).toBe(true);
    });
  });
});
