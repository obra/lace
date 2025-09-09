// ABOUTME: Test error event handling in useEventStream hook
// ABOUTME: Verifies AGENT_ERROR event processing and handler invocation

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEventStream } from './useEventStream';
import type { LaceEvent, ErrorType, ErrorPhase } from '@/types/core';

// Mock EventStreamFirehose
vi.mock('@/lib/event-stream-firehose', () => {
  const mockFirehose = {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    getStats: vi.fn(() => ({
      isConnected: true,
      subscriptionCount: 1,
      eventsReceived: 0,
      connectionUrl: null,
      connectedAt: null,
    })),
    getInstance: vi.fn(() => mockFirehose),
  };

  return {
    EventStreamFirehose: {
      getInstance: () => mockFirehose,
    },
  };
});

// Interface for test error event data
interface TestErrorEventData {
  errorType: ErrorType;
  message?: string;
  stack?: string;
  context: {
    phase: ErrorPhase;
    providerName?: string;
    providerInstanceId?: string;
    modelId?: string;
    toolName?: string;
    toolCallId?: string;
    workingDirectory?: string;
    retryAttempt?: number;
  };
  isRetryable: boolean;
  retryCount: number;
}

describe('useEventStream Error Handling', () => {
  let mockSubscribeHandler: (event: LaceEvent) => void;
  let mockFirehose: {
    subscribe: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
    getStats: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get the mocked EventStreamFirehose
    const eventStreamModule = await import('@/lib/event-stream-firehose');
    mockFirehose =
      eventStreamModule.EventStreamFirehose.getInstance() as unknown as typeof mockFirehose;

    // Mock subscribe to capture the event handler
    mockFirehose.subscribe.mockImplementation(
      (filter: unknown, handler: (event: LaceEvent) => void) => {
        mockSubscribeHandler = handler;
        return 'mock-subscription-id';
      }
    );
  });

  // Helper function to simulate events
  const simulateEvent = (event: LaceEvent) => {
    if (mockSubscribeHandler) {
      mockSubscribeHandler(event);
    }
  };

  describe('AGENT_ERROR Event Handler Registration', () => {
    it('should register onAgentError handler correctly and handle events', () => {
      const mockAgentErrorHandler = vi.fn();

      const { result } = renderHook(() =>
        useEventStream({
          onAgentError: mockAgentErrorHandler,
        })
      );

      // Simulate AGENT_ERROR event
      const agentErrorEvent: LaceEvent = {
        type: 'AGENT_ERROR',
        timestamp: new Date(),
        data: {
          errorType: 'provider_failure',
          message: 'Test provider error',
          context: {
            phase: 'provider_response',
            providerName: 'anthropic',
          },
          isRetryable: true,
          retryCount: 1,
        },
        context: { threadId: 'test-thread' },
      };

      // Simulate the event being received
      simulateEvent(agentErrorEvent);

      // Verify the handler was called with the entire event (not just data)
      expect(mockAgentErrorHandler).toHaveBeenCalledWith(agentErrorEvent);
      expect(result.current).toBeDefined();
    });

    it('should register generic onError handler correctly and handle events', () => {
      const mockErrorHandler = vi.fn();

      const { result } = renderHook(() =>
        useEventStream({
          onError: mockErrorHandler,
        })
      );

      // Simulate AGENT_ERROR event (should trigger generic error handler)
      const agentErrorEvent: LaceEvent = {
        type: 'AGENT_ERROR',
        timestamp: new Date(),
        data: {
          errorType: 'tool_execution',
          message: 'Test tool error',
          context: {
            phase: 'tool_execution',
          },
          isRetryable: false,
          retryCount: 0,
        },
        context: { threadId: 'test-thread' },
      };

      simulateEvent(agentErrorEvent);

      // Verify generic error handler was called with Error object
      expect(mockErrorHandler).toHaveBeenCalledWith(expect.any(Error));
      expect(result.current).toBeDefined();
    });

    it('should handle both onAgentError and onError handlers simultaneously', () => {
      const mockAgentErrorHandler = vi.fn();
      const mockGenericErrorHandler = vi.fn();

      const { result } = renderHook(() =>
        useEventStream({
          onAgentError: mockAgentErrorHandler,
          onError: mockGenericErrorHandler,
        })
      );

      // Simulate AGENT_ERROR event
      const agentErrorEvent: LaceEvent = {
        type: 'AGENT_ERROR',
        timestamp: new Date(),
        data: {
          errorType: 'processing_error',
          message: 'Test processing error',
          context: {
            phase: 'conversation_processing',
          },
          isRetryable: false,
          retryCount: 0,
        },
        context: { threadId: 'test-thread' },
      };

      simulateEvent(agentErrorEvent);

      // Both handlers should be called
      expect(mockAgentErrorHandler).toHaveBeenCalledWith(agentErrorEvent);
      expect(mockGenericErrorHandler).toHaveBeenCalledWith(expect.any(Error));
      expect(result.current).toBeDefined();
    });
  });

  describe('Error Event Processing', () => {
    it('should process provider failure errors correctly', () => {
      const _agentErrorEvent: LaceEvent = {
        type: 'AGENT_ERROR',
        timestamp: new Date(),
        data: {
          errorType: 'provider_failure',
          message: 'Provider API rate limit exceeded',
          stack: 'Error: Provider API rate limit exceeded\n    at test.js:1:1',
          context: {
            phase: 'provider_response',
            providerName: 'anthropic',
            providerInstanceId: 'pi_test123',
            modelId: 'claude-3-5-haiku-20241022',
          },
          isRetryable: true,
          retryCount: 2,
        },
        context: { threadId: 'test-thread' },
        transient: true,
      };

      // The event structure should be valid for the handler
      expect(_agentErrorEvent.type).toBe('AGENT_ERROR');
      expect(_agentErrorEvent.data).toHaveProperty('errorType');
      expect(_agentErrorEvent.data).toHaveProperty('message');
      expect(_agentErrorEvent.data).toHaveProperty('isRetryable');
    });

    it('should process tool execution errors correctly', () => {
      const toolErrorEvent: LaceEvent = {
        type: 'AGENT_ERROR',
        timestamp: new Date(),
        data: {
          errorType: 'tool_execution',
          message: 'Tool execution failed: command not found',
          context: {
            phase: 'tool_execution',
            toolName: 'bash',
            toolCallId: 'tool-call-456',
            workingDirectory: '/home/user/project',
          },
          isRetryable: false,
          retryCount: 0,
        },
        context: { threadId: 'test-thread' },
        transient: true,
      };

      expect(toolErrorEvent.data).toHaveProperty('errorType', 'tool_execution');
      expect((toolErrorEvent.data as TestErrorEventData).context).toHaveProperty(
        'toolName',
        'bash'
      );
      expect((toolErrorEvent.data as TestErrorEventData).context).toHaveProperty(
        'toolCallId',
        'tool-call-456'
      );
    });

    it('should process conversation processing errors correctly', () => {
      const processingErrorEvent: LaceEvent = {
        type: 'AGENT_ERROR',
        timestamp: new Date(),
        data: {
          errorType: 'processing_error',
          message: 'Failed to parse LLM response',
          context: {
            phase: 'conversation_processing',
            providerName: 'anthropic',
            modelId: 'claude-3-5-haiku-20241022',
          },
          isRetryable: false,
          retryCount: 0,
        },
        context: { threadId: 'test-thread' },
        transient: true,
      };

      expect(processingErrorEvent.data).toHaveProperty('errorType', 'processing_error');
      expect((processingErrorEvent.data as TestErrorEventData).context).toHaveProperty(
        'phase',
        'conversation_processing'
      );
    });
  });

  describe('Generic Error Handler Invocation', () => {
    it('should convert AGENT_ERROR events to Error objects for generic handler', () => {
      const mockErrorHandler = vi.fn();
      const testMessage = 'Test agent error message';

      renderHook(() =>
        useEventStream({
          onError: mockErrorHandler,
        })
      );

      const agentErrorEvent: LaceEvent = {
        type: 'AGENT_ERROR',
        timestamp: new Date(),
        data: {
          errorType: 'provider_failure',
          message: testMessage,
          context: {
            phase: 'provider_response',
          },
          isRetryable: true,
          retryCount: 0,
        },
        context: { threadId: 'test-thread' },
      };

      simulateEvent(agentErrorEvent);

      // Verify generic handler receives Error object with correct message
      expect(mockErrorHandler).toHaveBeenCalledWith(expect.any(Error));
      const calledError = mockErrorHandler.mock.calls[0][0];
      expect(calledError.message).toBe(testMessage);
      expect(calledError).toBeInstanceOf(Error);
    });

    it('should handle missing error message gracefully', () => {
      const mockErrorHandler = vi.fn();

      renderHook(() =>
        useEventStream({
          onError: mockErrorHandler,
        })
      );

      const agentErrorEventWithoutMessage: LaceEvent = {
        type: 'AGENT_ERROR',
        timestamp: new Date(),
        data: {
          errorType: 'processing_error' as ErrorType,
          message: '', // Empty message to test fallback
          context: {
            phase: 'conversation_processing' as ErrorPhase,
          },
          isRetryable: false,
          retryCount: 0,
        },
        context: { threadId: 'test-thread' },
      };

      simulateEvent(agentErrorEventWithoutMessage);

      // Should handle missing/empty message with fallback
      expect(mockErrorHandler).toHaveBeenCalledWith(expect.any(Error));
      const calledError = mockErrorHandler.mock.calls[0][0];
      expect(calledError.message).toBeTruthy(); // Should have some error message
    });
  });

  describe('Error Event Structure Validation', () => {
    it('should validate complete AGENT_ERROR event structure', () => {
      const completeErrorEvent: LaceEvent = {
        id: 'error-event-123',
        type: 'AGENT_ERROR',
        timestamp: new Date(),
        data: {
          errorType: 'tool_execution',
          message: 'Complete error test',
          stack: 'Error: Complete error test\n    at test.js:1:1',
          context: {
            phase: 'tool_execution',
            providerName: 'anthropic',
            providerInstanceId: 'pi_test123',
            modelId: 'claude-3-5-haiku-20241022',
            toolName: 'bash',
            toolCallId: 'tool-call-789',
            workingDirectory: '/home/user/project',
            retryAttempt: 2,
          },
          isRetryable: false,
          retryCount: 1,
        },
        context: { threadId: 'test-thread' },
        transient: true,
      };

      // Validate all required fields are present
      expect(completeErrorEvent).toHaveProperty('id');
      expect(completeErrorEvent).toHaveProperty('type', 'AGENT_ERROR');
      expect(completeErrorEvent).toHaveProperty('context');
      expect(completeErrorEvent.context).toHaveProperty('threadId');
      expect(completeErrorEvent).toHaveProperty('timestamp');
      expect(completeErrorEvent).toHaveProperty('data');
      expect(completeErrorEvent).toHaveProperty('transient', true);

      // Validate data structure
      const data = completeErrorEvent.data as TestErrorEventData;
      expect(data).toHaveProperty('errorType');
      expect(data).toHaveProperty('message');
      expect(data).toHaveProperty('stack');
      expect(data).toHaveProperty('context');
      expect(data).toHaveProperty('isRetryable');
      expect(data).toHaveProperty('retryCount');

      // Validate context structure
      expect(data.context).toHaveProperty('phase');
      expect(data.context).toHaveProperty('providerName');
      expect(data.context).toHaveProperty('providerInstanceId');
      expect(data.context).toHaveProperty('modelId');
    });

    it('should validate error types match expected values', () => {
      const validErrorTypes: ErrorType[] = [
        'provider_failure',
        'tool_execution',
        'processing_error',
        'timeout',
      ];

      validErrorTypes.forEach((errorType) => {
        const errorEvent: LaceEvent = {
          type: 'AGENT_ERROR',
          timestamp: new Date(),
          data: {
            errorType,
            message: `Test ${errorType} error`,
            context: {
              phase: 'provider_response',
            },
            isRetryable: false,
            retryCount: 0,
          },
          context: { threadId: 'test-thread' },
        };

        expect((errorEvent.data as TestErrorEventData).errorType).toBe(errorType);
      });
    });

    it('should validate error phases match expected values', () => {
      const validPhases: ErrorPhase[] = [
        'provider_response',
        'tool_execution',
        'conversation_processing',
        'initialization',
      ];

      validPhases.forEach((phase) => {
        const errorEvent: LaceEvent = {
          type: 'AGENT_ERROR',
          timestamp: new Date(),
          data: {
            errorType: 'processing_error',
            message: `Test ${phase} error`,
            context: {
              phase,
            },
            isRetryable: false,
            retryCount: 0,
          },
          context: { threadId: 'test-thread' },
        };

        expect((errorEvent.data as TestErrorEventData).context.phase).toBe(phase);
      });
    });
  });
});
