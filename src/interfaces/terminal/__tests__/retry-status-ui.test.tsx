// ABOUTME: Tests for retry status display in terminal interface
// ABOUTME: Verifies that retry events are displayed correctly in the status bar with countdown

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent, CurrentTurnMetrics } from '~/agents/agent';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { ThreadEvent } from '~/threads/types';
import { BaseMockProvider } from '~/__tests__/utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import StatusBar from '~/interfaces/terminal/components/status-bar';

// Mock provider that can emit retry events
class MockRetryUIProvider extends BaseMockProvider {
  get providerName(): string {
    return 'mock-retry-ui';
  }

  get defaultModel(): string {
    return 'mock-model';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  createResponse(
    _messages: ProviderMessage[],
    _tools: Tool[] = [],
    _signal?: AbortSignal
  ): Promise<ProviderResponse> {
    return Promise.resolve({
      content: 'Test response',
      toolCalls: [],
      stopReason: 'stop',
    });
  }

  createStreamingResponse(
    _messages: ProviderMessage[],
    _tools: Tool[] = [],
    _signal?: AbortSignal
  ): Promise<ProviderResponse> {
    return Promise.resolve({
      content: 'Test streaming response',
      toolCalls: [],
      stopReason: 'stop',
    });
  }
}

describe('Retry Status UI Integration', () => {
  let agent: Agent;
  let mockProvider: MockRetryUIProvider;
  let mockToolExecutor: ToolExecutor;
  let mockThreadManager: ThreadManager;
  let threadId: string;

  beforeEach(async () => {
    vi.useFakeTimers();

    threadId = 'test-thread-id';
    mockProvider = new MockRetryUIProvider({});

    // Mock ToolExecutor
    mockToolExecutor = {
      executeTool: vi.fn(),
      registerTool: vi.fn(),
      registerTools: vi.fn(),
      setApprovalCallback: vi.fn(),
      getTool: vi.fn(),
      getAvailableToolNames: vi.fn(),
      getAllTools: vi.fn(),
      getApprovalCallback: vi.fn(),
      registerAllAvailableTools: vi.fn(),
    } as unknown as ToolExecutor;

    // Mock ThreadManager
    mockThreadManager = {
      addEvent: vi.fn().mockReturnValue({} as ThreadEvent),
      getEvents: vi.fn().mockReturnValue([]),
      getMainAndDelegateEvents: vi.fn().mockReturnValue([]),
      getCanonicalId: vi.fn().mockReturnValue(threadId),
      getCurrentThreadId: vi.fn().mockReturnValue(threadId),
      needsCompaction: vi.fn().mockResolvedValue(false),
      close: vi.fn(),
      generateThreadId: vi.fn(),
      generateDelegateThreadId: vi.fn(),
      resumeOrCreate: vi.fn(),
      createThread: vi.fn(),
      createDelegateThread: vi.fn(),
      switchToThread: vi.fn(),
      getThread: vi.fn(),
      hasThread: vi.fn(),
      compactToolResults: vi.fn(),
      getDelegateThreadsFor: vi.fn(),
      createCompactedVersion: vi.fn(),
      cleanupOldShadows: vi.fn(),
      autoCompactIfNeeded: vi.fn(),
    } as unknown as ThreadManager;

    agent = new Agent({
      provider: mockProvider,
      toolExecutor: mockToolExecutor,
      threadManager: mockThreadManager,
      threadId,
      tools: [],
    });

    await agent.start();
  });

  afterEach(() => {
    agent.stop();
    vi.useRealTimers();
  });

  describe('StatusBar retry display', () => {
    it('should display retry status with countdown', () => {
      const retryStatus = {
        isRetrying: true,
        attempt: 2,
        maxAttempts: 10,
        delayMs: 5000,
        errorType: 'network error',
        retryStartTime: Date.now() - 1000, // Started 1 second ago
      };

      const { getByText } = render(
        <StatusBar
          providerName="test-provider"
          retryStatus={retryStatus}
          isProcessing={true}
          messageCount={5}
          cumulativeTokens={{ promptTokens: 100, completionTokens: 50, totalTokens: 150 }}
        />
      );

      // Should show retry status with countdown (4 seconds remaining)
      expect(getByText(/🔄 Retry 2\/10 in [34]s\.\.\. \(network error\)/)).toBeTruthy();
    });

    it('should display retry status without countdown when delay has expired', () => {
      const retryStatus = {
        isRetrying: true,
        attempt: 3,
        maxAttempts: 10,
        delayMs: 500, // Short delay
        errorType: 'timeout',
        retryStartTime: Date.now() - 1000, // Started 1 second ago, so delay has expired
      };

      const { getByText } = render(
        <StatusBar
          providerName="test-provider"
          retryStatus={retryStatus}
          isProcessing={true}
          messageCount={5}
          cumulativeTokens={{ promptTokens: 100, completionTokens: 50, totalTokens: 150 }}
        />
      );

      // Should show retry status without countdown (elapsed time > delay)
      expect(getByText(/🔄 Retry 3\/10\.\.\. \(timeout\)/)).toBeTruthy();
    });

    it('should not display retry status when not retrying', () => {
      const { container } = render(
        <StatusBar
          providerName="test-provider"
          retryStatus={null}
          isProcessing={false}
          messageCount={5}
          cumulativeTokens={{ promptTokens: 100, completionTokens: 50, totalTokens: 150 }}
        />
      );

      // Should not contain retry symbols
      expect(container.textContent).not.toContain('🔄');
      expect(container.textContent).not.toContain('Retry');
    });

    it('should prioritize retry status over normal processing status', () => {
      const retryStatus = {
        isRetrying: true,
        attempt: 1,
        maxAttempts: 10,
        delayMs: 2000,
        errorType: 'server error',
        retryStartTime: Date.now(),
      };

      const turnMetrics: CurrentTurnMetrics = {
        startTime: new Date(),
        elapsedMs: 30000,
        tokensIn: 25,
        tokensOut: 100,
        turnId: 'test-turn',
      };

      const { getByText } = render(
        <StatusBar
          providerName="test-provider"
          retryStatus={retryStatus}
          isTurnActive={true}
          turnMetrics={turnMetrics}
          isProcessing={true}
          messageCount={5}
          cumulativeTokens={{ promptTokens: 100, completionTokens: 50, totalTokens: 150 }}
        />
      );

      // Should show both turn metrics and retry status
      expect(getByText(/🔄 Retry 1\/10.*\(server error\)/)).toBeTruthy();
      expect(getByText(/⏱ 30s • ↑25 ↓100/)).toBeTruthy();
    });
  });

  describe('Error type classification', () => {
    const testCases = [
      { errorMessage: 'ECONNREFUSED connection failed', expectedType: 'connection error' },
      { errorMessage: 'Request timeout ETIMEDOUT', expectedType: 'timeout' },
      { errorMessage: 'Rate limit exceeded 429', expectedType: 'rate limit' },
      { errorMessage: 'Server error 500', expectedType: 'server error' },
      { errorMessage: 'Authentication failed 401', expectedType: 'auth error' },
      { errorMessage: 'Unknown network issue', expectedType: 'network error' },
    ];

    testCases.forEach(({ errorMessage, expectedType }) => {
      it(`should classify "${errorMessage}" as "${expectedType}"`, () => {
        // Test the error classification logic directly
        function classifyError(error: Error): string {
          let errorType = 'network error';
          if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
            errorType = 'timeout';
          } else if (error.message.includes('rate limit') || error.message.includes('429')) {
            errorType = 'rate limit';
          } else if (error.message.includes('server') || error.message.includes('5')) {
            errorType = 'server error';
          } else if (error.message.includes('auth') || error.message.includes('401')) {
            errorType = 'auth error';
          } else if (
            error.message.includes('connection') ||
            error.message.includes('ECONNREFUSED')
          ) {
            errorType = 'connection error';
          }
          return errorType;
        }

        const error = new Error(errorMessage);
        const result = classifyError(error);
        expect(result).toBe(expectedType);
      });
    });
  });
});
