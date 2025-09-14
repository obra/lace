// ABOUTME: Tests for thread event type definitions and token usage
// ABOUTME: Validates that events can store token usage data correctly

import { describe, it, expect } from 'vitest';
import {
  isTransientEventType,
  EVENT_TYPES,
  type LaceEvent,
  type LaceEventType,
} from '~/threads/types';

describe('LaceEvent token usage', () => {
  it('should allow AGENT_MESSAGE with token usage', () => {
    const event: LaceEvent = {
      id: 'evt_123',
      threadId: 'thread_123',
      type: 'AGENT_MESSAGE',
      timestamp: new Date(),
      data: {
        content: 'Hello',
        tokenUsage: {
          message: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          thread: {
            totalPromptTokens: 100,
            totalCompletionTokens: 50,
            totalTokens: 150,
            contextLimit: 200000,
            percentUsed: 0.1,
            nearLimit: false,
          },
        },
      },
    };

    expect(event.data.tokenUsage).toBeDefined();
    expect(event.data.tokenUsage?.thread.totalTokens).toBe(150);
  });

  it('should allow AGENT_MESSAGE without token usage', () => {
    const event: LaceEvent = {
      id: 'evt_123',
      threadId: 'thread_123',
      type: 'AGENT_MESSAGE',
      timestamp: new Date(),
      data: {
        content: 'Hello',
      },
    };

    expect(event.data.tokenUsage).toBeUndefined();
  });

  it('should allow TOOL_RESULT with token usage', () => {
    const event: LaceEvent = {
      id: 'evt_456',
      threadId: 'thread_123',
      type: 'TOOL_RESULT',
      timestamp: new Date(),
      data: {
        content: [{ type: 'text', text: 'Tool output' }],
        status: 'completed',
        tokenUsage: {
          message: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
          thread: {
            totalPromptTokens: 50,
            totalCompletionTokens: 25,
            totalTokens: 75,
            contextLimit: 200000,
            percentUsed: 0.1,
            nearLimit: false,
          },
        },
      },
    };

    expect(event.data.tokenUsage).toBeDefined();
    expect(event.data.tokenUsage?.message?.promptTokens).toBe(50);
  });

  it('should allow TOOL_RESULT without token usage', () => {
    const event: LaceEvent = {
      id: 'evt_456',
      threadId: 'thread_123',
      type: 'TOOL_RESULT',
      timestamp: new Date(),
      data: {
        content: [{ type: 'text', text: 'Tool output' }],
        status: 'completed',
      },
    };

    expect(event.data.tokenUsage).toBeUndefined();
  });
});

// Factory function for creating SESSION_UPDATED test events
function createSessionUpdatedEvent(overrides: Partial<LaceEvent> = {}): LaceEvent {
  return {
    id: 'evt_session_123',
    timestamp: new Date('2023-01-01T10:00:00Z'),
    type: 'SESSION_UPDATED',
    data: {
      name: 'Test Session Name',
    },
    context: {
      sessionId: 'lace_20240101_abc123',
      projectId: 'project-456',
    },
    ...overrides,
  };
}

describe('Session Event Types', () => {
  it('should include SESSION_UPDATED in EVENT_TYPES array', () => {
    expect(EVENT_TYPES).toContain('SESSION_UPDATED');
  });

  it('should classify SESSION_UPDATED as transient event type', () => {
    expect(isTransientEventType('SESSION_UPDATED')).toBe(true);
  });

  it('should validate SessionUpdatedData interface with valid session event', () => {
    const validSessionEvent = createSessionUpdatedEvent({
      data: {
        name: 'Fix Auth Bug',
      },
    });

    expect(validSessionEvent.type).toBe('SESSION_UPDATED');
    expect(validSessionEvent.data.name).toBe('Fix Auth Bug');
    expect(validSessionEvent.context?.sessionId).toBe('lace_20240101_abc123');
    expect(validSessionEvent.context?.projectId).toBe('project-456');
  });

  it('should ensure SESSION_UPDATED is properly typed in LaceEventType union', () => {
    const eventType: LaceEventType = 'SESSION_UPDATED';
    expect(eventType).toBe('SESSION_UPDATED');
  });
});

// Factory function for creating AGENT_ERROR test events
function createAgentErrorEvent(overrides: Partial<LaceEvent> = {}): LaceEvent {
  return {
    id: 'evt_error_123',
    threadId: 'test-thread-id',
    timestamp: new Date('2023-01-01T10:00:00Z'),
    type: 'AGENT_ERROR',
    data: {
      errorType: 'processing_error',
      message: 'Test error message',
      context: {
        phase: 'provider_response',
      },
      isRetryable: false,
    },
    ...overrides,
  };
}

describe('Error Event Types', () => {
  it('should include AGENT_ERROR in EVENT_TYPES array', () => {
    expect(EVENT_TYPES).toContain('AGENT_ERROR');
  });

  it('should classify AGENT_ERROR as transient event type', () => {
    expect(isTransientEventType('AGENT_ERROR')).toBe(true);
  });

  it('should validate AgentErrorData interface with valid error event', () => {
    const validErrorEvent = createAgentErrorEvent({
      data: {
        errorType: 'provider_failure',
        message: 'Test error message',
        stack: 'Error: Test error\n    at test.js:1:1',
        context: {
          phase: 'provider_response',
          providerName: 'anthropic',
          providerInstanceId: 'claude-3',
          modelId: 'claude-3-haiku',
        },
        isRetryable: true,
        retryCount: 0,
      },
    });

    expect(validErrorEvent.type).toBe('AGENT_ERROR');
    expect(validErrorEvent.data.errorType).toBe('provider_failure');
    expect(validErrorEvent.data.isRetryable).toBe(true);
    expect(validErrorEvent.data.context.phase).toBe('provider_response');
  });

  it('should accept all valid error types', () => {
    const errorTypes = [
      'provider_failure',
      'tool_execution',
      'processing_error',
      'timeout',
      'streaming_error',
    ] as const;

    errorTypes.forEach((errorType) => {
      const errorEvent = createAgentErrorEvent({
        data: {
          errorType,
          message: `Test ${errorType} error`,
          context: {
            phase: 'provider_response',
          },
          isRetryable: false,
        },
      });

      expect(errorEvent.data.errorType).toBe(errorType);
    });
  });

  it('should accept all valid phases', () => {
    const phases = [
      'provider_response',
      'tool_execution',
      'conversation_processing',
      'initialization',
    ] as const;

    phases.forEach((phase) => {
      const errorEvent = createAgentErrorEvent({
        data: {
          errorType: 'processing_error',
          message: `Test ${phase} error`,
          context: {
            phase,
          },
          isRetryable: false,
        },
      });

      expect(errorEvent.data.context.phase).toBe(phase);
    });
  });

  it('should handle optional context fields correctly', () => {
    const errorEvent = createAgentErrorEvent({
      data: {
        errorType: 'tool_execution',
        message: 'Tool execution failed',
        context: {
          phase: 'tool_execution',
          toolName: 'bash',
          toolCallId: 'tool-call-123',
          workingDirectory: '/home/user',
          retryAttempt: 2,
        },
        isRetryable: true,
        retryCount: 1,
      },
    });

    expect(errorEvent.data.context.toolName).toBe('bash');
    expect(errorEvent.data.context.toolCallId).toBe('tool-call-123');
    expect(errorEvent.data.context.workingDirectory).toBe('/home/user');
    expect(errorEvent.data.context.retryAttempt).toBe(2);
    expect(errorEvent.data.retryCount).toBe(1);
  });

  it('should ensure AGENT_ERROR is properly typed in LaceEventType union', () => {
    const eventType: LaceEventType = 'AGENT_ERROR';
    expect(eventType).toBe('AGENT_ERROR');
  });
});
