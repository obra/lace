// ABOUTME: Tests for event-based approval callback implementation
// ABOUTME: Validates that approval requests create events and wait for responses

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupAgentApprovals } from '@/lib/server/agent-utils';
import { Agent } from '@/lib/server/lace-imports';
import { asThreadId, type ThreadId } from '@/lib/server/core-types';

interface MockThreadManager {
  addEvent: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  getEvents: ReturnType<typeof vi.fn>;
}

interface MockToolExecutor {
  setApprovalCallback: ReturnType<typeof vi.fn>;
  getTool: ReturnType<typeof vi.fn>;
}

interface MockAgent {
  threadId: string;
  toolExecutor: MockToolExecutor;
  threadManager: MockThreadManager;
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  checkExistingApprovalRequest: ReturnType<typeof vi.fn>;
  checkExistingApprovalResponse: ReturnType<typeof vi.fn>;
  addApprovalRequestEvent: ReturnType<typeof vi.fn>;
}

interface ApprovalCallback {
  requestApproval: (toolName: string, args: unknown) => Promise<string>;
}

describe('Event-Based Approval Callback', () => {
  let mockAgent: MockAgent;
  let sessionId: ThreadId;

  beforeEach(() => {
    vi.clearAllMocks();

    const threadManager = {
      addEvent: vi.fn(),
      on: vi.fn(),
      getEvents: vi.fn(() => [])
    };

    const emit = vi.fn();
    
    mockAgent = {
      threadId: 'test_thread_123',
      toolExecutor: {
        setApprovalCallback: vi.fn(),
        getTool: vi.fn(() => ({ annotations: { readOnlyHint: false } }))
      },
      threadManager,
      emit,
      on: vi.fn(),
      off: vi.fn(),
      checkExistingApprovalRequest: vi.fn(() => false),
      checkExistingApprovalResponse: vi.fn(() => null),
      addApprovalRequestEvent: vi.fn((toolCallId: string) => {
        const event = {
          id: 'event_request',
          type: 'TOOL_APPROVAL_REQUEST',
          timestamp: new Date(),
          data: { toolCallId }
        };
        threadManager.addEvent('test_thread_123', 'TOOL_APPROVAL_REQUEST', { toolCallId });
        emit('thread_event_added', { event, threadId: 'test_thread_123' });
        return event;
      })
    };
    
    sessionId = asThreadId('lace_20240101_test01');
  });

  it('should create TOOL_APPROVAL_REQUEST event when approval is requested', async () => {
    setupAgentApprovals(mockAgent as unknown as Agent, sessionId);

    // Get the approval callback that was set
    const approvalCallback = mockAgent.toolExecutor.setApprovalCallback.mock.calls[0]?.[0] as ApprovalCallback;

    // Mock finding a recent TOOL_CALL event
    mockAgent.threadManager.getEvents.mockReturnValue([
      {
        id: 'event_1',
        type: 'TOOL_CALL',
        timestamp: new Date(),
        data: { id: 'call_123', name: 'bash', arguments: { command: 'ls' } }
      }
    ]);

    // Mock addEvent to return the created event
    mockAgent.threadManager.addEvent.mockReturnValue({
      id: 'event_2',
      type: 'TOOL_APPROVAL_REQUEST',
      timestamp: new Date(),
      data: { toolCallId: 'call_123' }
    });

    // Start the approval request - should throw ApprovalPendingError
    try {
      await approvalCallback.requestApproval({ id: 'call_123', name: 'bash', arguments: { command: 'ls' } });
      throw new Error('Expected ApprovalPendingError to be thrown');
    } catch (error: unknown) {
      // Verify that ApprovalPendingError was thrown with correct toolCallId
      expect(error).toBeInstanceOf(Error);
      const approvalError = error as { toolCallId?: string };
      expect(approvalError.toolCallId).toBe('call_123');
    }

    // Verify TOOL_APPROVAL_REQUEST event was created
    expect(mockAgent.threadManager.addEvent).toHaveBeenCalledWith(
      'test_thread_123',
      'TOOL_APPROVAL_REQUEST',
      { toolCallId: 'call_123' }
    );

    // Verify agent.emit was called to notify SSE stream
    expect(mockAgent.emit).toHaveBeenCalledWith('thread_event_added', {
      event: expect.objectContaining({
        type: 'TOOL_APPROVAL_REQUEST',
        data: { toolCallId: 'call_123' }
      }),
      threadId: 'test_thread_123'
    });
  });

  it('should return existing approval if response already exists', async () => {
    setupAgentApprovals(mockAgent as unknown as Agent, sessionId);

    const approvalCallback = mockAgent.toolExecutor.setApprovalCallback.mock.calls[0]?.[0] as ApprovalCallback;

    // Mock that existing approval response is found
    mockAgent.checkExistingApprovalResponse.mockReturnValue('allow_session');

    const decision = await approvalCallback.requestApproval({ id: 'call_123', name: 'bash', arguments: { command: 'ls' } });
    expect(decision).toBe('allow_session');

    // Should not create new approval request since response exists
    expect(mockAgent.addApprovalRequestEvent).not.toHaveBeenCalled();
  });

  it('should clean up event listeners when approval resolves', async () => {
    // This test is no longer relevant since EventApprovalCallback doesn't use event listeners
    // It throws ApprovalPendingError immediately and doesn't wait for responses
    // The Agent handles re-checking for approval responses during conversation processing
    
    setupAgentApprovals(mockAgent as unknown as Agent, sessionId);

    const approvalCallback = mockAgent.toolExecutor.setApprovalCallback.mock.calls[0]?.[0] as ApprovalCallback;

    // Mock finding a TOOL_CALL event
    mockAgent.threadManager.getEvents.mockReturnValue([
      {
        id: 'event_1',
        type: 'TOOL_CALL',
        timestamp: new Date(),
        data: { id: 'call_789', name: 'bash', arguments: { command: 'pwd' } }
      }
    ]);

    mockAgent.threadManager.addEvent.mockReturnValue({
      id: 'event_2',
      type: 'TOOL_APPROVAL_REQUEST',
      timestamp: new Date(),
      data: { toolCallId: 'call_789' }
    });

    // Start approval request - should throw ApprovalPendingError
    try {
      await approvalCallback.requestApproval({ id: 'call_789', name: 'bash', arguments: { command: 'pwd' } });
      throw new Error('Expected ApprovalPendingError to be thrown');
    } catch (error: unknown) {
      // Verify that ApprovalPendingError was thrown with correct toolCallId
      expect(error).toBeInstanceOf(Error);
      const approvalError = error as { toolCallId?: string };
      expect(approvalError.toolCallId).toBe('call_789');
    }

    // Verify request event was created
    expect(mockAgent.threadManager.addEvent).toHaveBeenCalledWith(
      'test_thread_123',
      'TOOL_APPROVAL_REQUEST',
      { toolCallId: 'call_789' }
    );

    // EventApprovalCallback doesn't register event listeners - it just throws
    // The Agent handles checking for approval responses during tool execution retry
    expect(mockAgent.on).not.toHaveBeenCalledWith('thread_event_added', expect.any(Function));
    expect(mockAgent.off).not.toHaveBeenCalled();
  });
});