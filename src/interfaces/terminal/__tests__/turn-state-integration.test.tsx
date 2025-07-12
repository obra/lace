// ABOUTME: Tests for turn state integration and terminal interface logic
// ABOUTME: Validates turn state management responds correctly to Agent lifecycle events

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { AIProvider } from '~/providers/base-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { TerminalInterface } from '~/interfaces/terminal/terminal-interface';

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
      const error = new Error('Request aborted');
      error.name = 'AbortError';
      throw error;
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

describe('Turn State Integration Tests', () => {
  let agent: Agent;
  let provider: MockProvider;
  let toolExecutor: ToolExecutor;
  let threadManager: ThreadManager;
  let threadId: string;
  let terminalInterface: TerminalInterface;

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
    terminalInterface = new TerminalInterface(agent);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Agent integration', () => {
    it('should properly initialize with agent', () => {
      // Arrange & Act
      const testInterface = new TerminalInterface(agent);

      // Assert
      expect(testInterface).toBeDefined();
      expect(testInterface).toBeInstanceOf(TerminalInterface);
    });

    it('should integrate turn events with interface state', async () => {
      // Arrange
      let turnStarted = false;
      let turnCompleted = false;
      let turnAborted = false;

      agent.on('turn_start', () => {
        turnStarted = true;
      });
      agent.on('turn_complete', () => {
        turnCompleted = true;
      });
      agent.on('turn_aborted', () => {
        turnAborted = true;
      });

      // Act - normal operation
      await agent.sendMessage('Test message');

      // Assert
      expect(turnStarted).toBe(true);
      expect(turnCompleted).toBe(true);
      expect(turnAborted).toBe(false);
    });

    it('should handle abort during interface operation', async () => {
      // Arrange
      let turnStarted = false;
      let turnAborted = false;

      agent.on('turn_start', () => {
        turnStarted = true;
      });
      agent.on('turn_aborted', () => {
        turnAborted = true;
      });

      // Act - start and abort operation
      const messagePromise = agent.sendMessage('Test message');
      await new Promise((resolve) => setTimeout(resolve, 10));
      agent.abort();
      await messagePromise;

      // Assert
      expect(turnStarted).toBe(true);
      expect(turnAborted).toBe(true);
    });
  });

  describe('Approval system integration', () => {
    it('should handle approval requests correctly', () => {
      // Arrange
      let approvalRequested = false;

      agent.on('approval_request', () => {
        approvalRequested = true;
      });

      // Act - simulate approval request
      agent.emit('approval_request', {
        toolName: 'test_tool',
        input: {},
        isReadOnly: false,
        requestId: 'test-request-1',
        resolve: vi.fn(),
      });

      // Assert
      expect(approvalRequested).toBe(true);
    });

    it('should provide approval callback interface', () => {
      // Act
      const approvalPromise = terminalInterface.requestApproval('test_tool', { param: 'value' });

      // Assert
      expect(approvalPromise).toBeInstanceOf(Promise);

      // Resolve the approval to prevent hanging
      setTimeout(() => {
        agent.emit('approval_request', {
          toolName: 'test_tool',
          input: { param: 'value' },
          isReadOnly: false,
          requestId: 'test-request-2',
          resolve: (_decision: unknown) => {
            // Mock resolve
          },
        });
      }, 10);
    });
  });

  describe('Error handling', () => {
    it('should handle agent errors gracefully', () => {
      // Arrange
      let errorCaught = false;

      agent.on('error', () => {
        errorCaught = true;
      });

      // Act
      agent.emit('error', {
        error: new Error('Test error'),
        context: { phase: 'test', threadId: 'test-thread' },
      });

      // Assert
      expect(errorCaught).toBe(true);
    });

    it('should prevent starting when already running', async () => {
      // Arrange
      terminalInterface['isRunning'] = true; // Access private property for testing

      // Act & Assert
      await expect(terminalInterface.startInteractive()).rejects.toThrow(
        'Terminal interface is already running'
      );
    });
  });

  describe('State management', () => {
    it('should track running state correctly', async () => {
      // Arrange
      expect(terminalInterface['isRunning']).toBe(false);

      // Act - start interface (but don't actually render)
      terminalInterface['isRunning'] = true; // Simulate starting

      // Assert
      expect(terminalInterface['isRunning']).toBe(true);

      // Cleanup
      await terminalInterface.stop();
      expect(terminalInterface['isRunning']).toBe(false);
    });

    it('should handle stop gracefully', async () => {
      // Arrange
      terminalInterface['isRunning'] = true;

      // Act
      await terminalInterface.stop();

      // Assert
      expect(terminalInterface['isRunning']).toBe(false);
    });

    it('should handle stop when not running', async () => {
      // Arrange - interface not running
      expect(terminalInterface['isRunning']).toBe(false);

      // Act & Assert - should not throw
      await expect(terminalInterface.stop()).resolves.toBeUndefined();
    });
  });

  describe('Token usage tracking', () => {
    it('should handle token usage updates', () => {
      // Arrange
      let tokenUsageReceived = false;

      agent.on('token_usage_update', () => {
        tokenUsageReceived = true;
      });

      // Act
      agent.emit('token_usage_update', {
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      });

      // Assert
      expect(tokenUsageReceived).toBe(true);
    });

    it('should handle token budget warnings', () => {
      // Arrange
      let budgetWarningReceived = false;

      agent.on('token_budget_warning', () => {
        budgetWarningReceived = true;
      });

      // Act
      agent.emit('token_budget_warning', {
        message: 'Budget warning',
        usage: {
          totalUsed: 1000,
          maxTokens: 2000,
          availableTokens: 1000,
          usagePercentage: 50,
          warningTriggered: true,
          effectiveLimit: 1800,
          promptTokens: 600,
          completionTokens: 400,
        },
        recommendations: {
          shouldSummarize: false,
          shouldPrune: false,
          maxRequestSize: 1000,
        },
      });

      // Assert
      expect(budgetWarningReceived).toBe(true);
    });
  });
});
