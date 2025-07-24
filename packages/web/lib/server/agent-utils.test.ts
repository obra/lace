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

  it('should clean up event listeners when approval resolves', async () => {
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

    // Start approval request
    const approvalPromise = approvalCallback.requestApproval('bash', { command: 'pwd' });

    // Verify request event was created
    expect(mockAgent.threadManager.addEvent).toHaveBeenCalledWith(
      'test_thread_123',
      'TOOL_APPROVAL_REQUEST',
      { toolCallId: 'call_789' }
    );

    // Get the event listener
    const onCall = mockAgent.on.mock.calls.find(
      call => call[0] === 'thread_event_added'
    );
    expect(onCall).toBeDefined();
    
    const eventListener = onCall?.[1] as (data: { event: { type: string; data: { toolCallId: string; decision: string } }; threadId: string }) => void;

    // Trigger approval response
    eventListener({
      event: {
        type: 'TOOL_APPROVAL_RESPONSE',
        data: { toolCallId: 'call_789', decision: 'deny' }
      },
      threadId: 'test_thread_123'
    });

    // Promise should resolve
    const decision = await approvalPromise;
    expect(decision).toBe('deny');

    // Verify event listener cleanup was called
    expect(mockAgent.off).toHaveBeenCalledWith('thread_event_added', eventListener);
  });
});