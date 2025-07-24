// ABOUTME: Tests for core event-based approval callback implementation
// ABOUTME: Validates approval logic that creates events and waits for responses

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventApprovalCallback } from '~/tools/event-approval-callback';
import { ApprovalDecision } from '~/tools/approval-types';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { ThreadManager } from '~/threads/thread-manager';
import { Agent } from '~/agents/agent';

describe('EventApprovalCallback', () => {
  let threadManager: ThreadManager;
  let mockAgent: any;
  let threadId: string;
  let callback: EventApprovalCallback;

  beforeEach(() => {
    setupTestPersistence();
    threadManager = new ThreadManager();
    threadId = threadManager.generateThreadId();

    // Create the thread before adding events
    threadManager.createThread(threadId);

    // Create mock agent
    mockAgent = {
      threadId,
      threadManager,
      toolExecutor: {
        getTool: vi.fn(() => ({ annotations: { readOnlyHint: false } })),
      },
    };

    callback = new EventApprovalCallback(mockAgent, threadManager, threadId);
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  it('should create TOOL_APPROVAL_REQUEST event when approval needed', async () => {
    // Create a TOOL_CALL event first
    const toolCallEvent = threadManager.addEvent(threadId, 'TOOL_CALL', {
      id: 'call_123',
      name: 'bash',
      arguments: { command: 'ls' },
    });

    // Start approval request (don't await yet)
    const approvalPromise = callback.requestApproval('bash', { command: 'ls' });

    // Check that TOOL_APPROVAL_REQUEST event was created
    const events = threadManager.getEvents(threadId);
    const approvalRequestEvent = events.find((e) => e.type === 'TOOL_APPROVAL_REQUEST');

    expect(approvalRequestEvent).toBeDefined();
    expect(approvalRequestEvent?.data).toEqual({ toolCallId: 'call_123' });

    // Resolve the approval by adding response event
    threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'call_123',
      decision: ApprovalDecision.ALLOW_ONCE,
    });

    // Promise should now resolve
    const decision = await approvalPromise;
    expect(decision).toBe(ApprovalDecision.ALLOW_ONCE);
  });

  it('should return existing approval if response already exists', async () => {
    // Create TOOL_CALL → TOOL_APPROVAL_REQUEST → TOOL_APPROVAL_RESPONSE
    threadManager.addEvent(threadId, 'TOOL_CALL', {
      id: 'call_123',
      name: 'bash',
      arguments: { command: 'ls' },
    });

    threadManager.addEvent(threadId, 'TOOL_APPROVAL_REQUEST', {
      toolCallId: 'call_123',
    });

    threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'call_123',
      decision: ApprovalDecision.ALLOW_SESSION,
    });

    // Request approval - should return existing decision immediately
    const decision = await callback.requestApproval('bash', { command: 'ls' });
    expect(decision).toBe(ApprovalDecision.ALLOW_SESSION);

    // Should not create duplicate TOOL_APPROVAL_REQUEST
    const events = threadManager.getEvents(threadId);
    const approvalRequests = events.filter((e) => e.type === 'TOOL_APPROVAL_REQUEST');
    expect(approvalRequests).toHaveLength(1); // Only the one we created manually
  });

  it('should handle multiple concurrent approval requests', async () => {
    // Create two different TOOL_CALL events
    threadManager.addEvent(threadId, 'TOOL_CALL', {
      id: 'call_123',
      name: 'bash',
      arguments: { command: 'ls' },
    });

    threadManager.addEvent(threadId, 'TOOL_CALL', {
      id: 'call_456',
      name: 'file-read',
      arguments: { path: '/test' },
    });

    // Start two approval requests concurrently
    const approval1Promise = callback.requestApproval('bash', { command: 'ls' });
    const approval2Promise = callback.requestApproval('file-read', { path: '/test' });

    // Both should create approval request events
    const events = threadManager.getEvents(threadId);
    const approvalRequests = events.filter((e) => e.type === 'TOOL_APPROVAL_REQUEST');
    expect(approvalRequests).toHaveLength(2);

    // Respond to both approvals
    threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'call_123',
      decision: ApprovalDecision.ALLOW_ONCE,
    });

    threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'call_456',
      decision: ApprovalDecision.DENY,
    });

    // Both promises should resolve with correct decisions
    const [decision1, decision2] = await Promise.all([approval1Promise, approval2Promise]);
    expect(decision1).toBe(ApprovalDecision.ALLOW_ONCE);
    expect(decision2).toBe(ApprovalDecision.DENY);
  });

  it('should throw error if no matching TOOL_CALL event found', async () => {
    // Try to request approval without creating TOOL_CALL first
    await expect(callback.requestApproval('bash', { command: 'ls' })).rejects.toThrow(
      'Could not find TOOL_CALL event for bash'
    );
  });

  it('should match tool call by name and arguments', async () => {
    // Create two TOOL_CALL events with same name but different arguments
    threadManager.addEvent(threadId, 'TOOL_CALL', {
      id: 'call_123',
      name: 'bash',
      arguments: { command: 'ls' },
    });

    threadManager.addEvent(threadId, 'TOOL_CALL', {
      id: 'call_456',
      name: 'bash',
      arguments: { command: 'pwd' },
    });

    // Request approval for specific arguments
    const approvalPromise = callback.requestApproval('bash', { command: 'pwd' });

    // Should match the second TOOL_CALL (call_456)
    const events = threadManager.getEvents(threadId);
    const approvalRequest = events.find((e) => e.type === 'TOOL_APPROVAL_REQUEST');
    expect(approvalRequest?.data).toEqual({ toolCallId: 'call_456' });

    // Resolve the approval
    threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'call_456',
      decision: ApprovalDecision.ALLOW_ONCE,
    });

    const decision = await approvalPromise;
    expect(decision).toBe(ApprovalDecision.ALLOW_ONCE);
  });
});
