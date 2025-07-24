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
}

interface ApprovalCallback {
  requestApproval: (toolName: string, args: unknown) => Promise<string>;
}

describe('Event-Based Approval Callback', () => {
  let mockAgent: MockAgent;
  let sessionId: ThreadId;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockAgent = {
      threadId: 'test_thread_123',
      toolExecutor: {
        setApprovalCallback: vi.fn(),
        getTool: vi.fn(() => ({ annotations: { readOnlyHint: false } }))
      },
      threadManager: {
        addEvent: vi.fn(),
        on: vi.fn(),
        getEvents: vi.fn(() => [])
      },
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
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

    // Start the approval request (don't await yet)
    const approvalPromise = approvalCallback.requestApproval('bash', { command: 'ls' });

    // Verify TOOL_APPROVAL_REQUEST event was created
    expect(mockAgent.threadManager.addEvent).toHaveBeenCalledWith(
      'test_thread_123',
      'TOOL_APPROVAL_REQUEST',
      { toolCallId: 'call_123' }
    );

    // Simulate approval response by finding and calling the event listener
    const onCall = mockAgent.on.mock.calls.find(
      call => call[0] === 'thread_event_added'
    );
    expect(onCall).toBeDefined();
    
    const eventListener = onCall?.[1] as (data: { event: { type: string; data: { toolCallId: string; decision: string } }; threadId: string }) => void;
    expect(eventListener).toBeDefined();

    // Trigger approval response
    eventListener({
      event: {
        type: 'TOOL_APPROVAL_RESPONSE',
        data: { toolCallId: 'call_123', decision: 'allow_once' }
      },
      threadId: 'test_thread_123'
    });

    // Now the promise should resolve
    const decision = await approvalPromise;
    expect(decision).toBe('allow_once');
  });

  it('should return existing approval if response already exists', async () => {
    setupAgentApprovals(mockAgent as unknown as Agent, sessionId);

    const approvalCallback = mockAgent.toolExecutor.setApprovalCallback.mock.calls[0]?.[0] as ApprovalCallback;

    // Mock finding recent TOOL_CALL and existing response
    mockAgent.threadManager.getEvents.mockReturnValue([
      {
        id: 'event_1',
        type: 'TOOL_CALL',
        timestamp: new Date(),
        data: { id: 'call_123', name: 'bash', arguments: { command: 'ls' } }
      },
      {
        id: 'event_3',
        type: 'TOOL_APPROVAL_RESPONSE',
        timestamp: new Date(),
        data: { toolCallId: 'call_123', decision: 'allow_session' }
      }
    ]);

    const decision = await approvalCallback.requestApproval('bash', { command: 'ls' });
    expect(decision).toBe('allow_session');

    // Should not create new approval request since response exists
    expect(mockAgent.threadManager.addEvent).not.toHaveBeenCalled();
  });

  it('should handle multiple concurrent approval requests', async () => {
    setupAgentApprovals(mockAgent as unknown as Agent, sessionId);

    const approvalCallback = mockAgent.toolExecutor.setApprovalCallback.mock.calls[0]?.[0] as ApprovalCallback;

    // Mock two different TOOL_CALL events
    mockAgent.threadManager.getEvents.mockReturnValue([
      {
        id: 'event_1',
        type: 'TOOL_CALL',
        timestamp: new Date('2025-01-01T10:00:00Z'),
        data: { id: 'call_123', name: 'bash', arguments: { command: 'ls' } }
      },
      {
        id: 'event_2',
        type: 'TOOL_CALL',
        timestamp: new Date('2025-01-01T10:01:00Z'),
        data: { id: 'call_456', name: 'file-read', arguments: { path: '/test' } }
      }
    ]);

    let addEventCallCount = 0;
    mockAgent.threadManager.addEvent.mockImplementation((_threadId: string, type: string, data: unknown) => {
      addEventCallCount++;
      return {
        id: `event_${addEventCallCount + 2}`,
        type,
        timestamp: new Date(),
        data
      };
    });

    // Start two approval requests concurrently
    const approval1Promise = approvalCallback.requestApproval('bash', { command: 'ls' });
    const approval2Promise = approvalCallback.requestApproval('file-read', { path: '/test' });

    // Both should create approval request events
    expect(mockAgent.threadManager.addEvent).toHaveBeenCalledTimes(2);
    expect(mockAgent.threadManager.addEvent).toHaveBeenCalledWith(
      'test_thread_123',
      'TOOL_APPROVAL_REQUEST',
      { toolCallId: 'call_123' }
    );
    expect(mockAgent.threadManager.addEvent).toHaveBeenCalledWith(
      'test_thread_123',
      'TOOL_APPROVAL_REQUEST',
      { toolCallId: 'call_456' }
    );

    // Get the event listener
    const onCall = mockAgent.on.mock.calls.find(
      call => call[0] === 'thread_event_added'
    );
    expect(onCall).toBeDefined();
    
    const eventListener = onCall?.[1] as (data: { event: { type: string; data: { toolCallId: string; decision: string } }; threadId: string }) => void;

    // Respond to first approval
    eventListener({
      event: {
        type: 'TOOL_APPROVAL_RESPONSE',
        data: { toolCallId: 'call_123', decision: 'allow_once' }
      },
      threadId: 'test_thread_123'
    });

    // Respond to second approval
    eventListener({
      event: {
        type: 'TOOL_APPROVAL_RESPONSE',
        data: { toolCallId: 'call_456', decision: 'deny' }
      },
      threadId: 'test_thread_123'
    });

    // Both promises should resolve with correct decisions
    const [decision1, decision2] = await Promise.all([approval1Promise, approval2Promise]);
    expect(decision1).toBe('allow_once');
    expect(decision2).toBe('deny');
  });
});