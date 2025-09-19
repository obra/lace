// ABOUTME: Test for session-wide getPendingApprovals functionality
// ABOUTME: Verifies that getPendingApprovals can efficiently query all approvals for a session

import { describe, it, expect, beforeEach } from 'vitest';
import { DatabasePersistence, getPersistence } from './database';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import type { LaceEvent } from '~/threads/types';

describe('getPendingApprovals Session-wide Query', () => {
  const _tempLaceDir = setupCoreTest();
  let db: DatabasePersistence;

  beforeEach(() => {
    db = getPersistence();

    // Create a project first (required for foreign key constraint)
    db.saveProject({
      id: 'test_project',
      name: 'Test Project',
      path: '/tmp/test-project',
      workingDirectory: '/tmp/test-project',
      description: 'Test project for approval testing',
      createdAt: new Date('2025-09-19T09:00:00Z'),
      updatedAt: new Date('2025-09-19T09:00:00Z'),
      lastUsedAt: new Date('2025-09-19T09:00:00Z'),
    });

    // Create a session
    db.saveSession({
      id: 'test_session_001',
      projectId: 'test_project',
      name: 'Test Session',
      description: 'Test session for approval testing',
      configuration: {},
      status: 'active',
      createdAt: new Date('2025-09-19T10:00:00Z'),
      updatedAt: new Date('2025-09-19T10:00:00Z'),
    });

    // Create multiple threads for the session (coordinator + delegates)
    db.saveThread({
      id: 'test_session_001', // Coordinator thread has same ID as session
      sessionId: 'test_session_001',
      createdAt: new Date('2025-09-19T10:00:00Z'),
      updatedAt: new Date('2025-09-19T10:00:00Z'),
      events: [],
    });

    db.saveThread({
      id: 'test_session_001.1', // Delegate agent 1
      sessionId: 'test_session_001',
      createdAt: new Date('2025-09-19T10:01:00Z'),
      updatedAt: new Date('2025-09-19T10:01:00Z'),
      events: [],
    });

    db.saveThread({
      id: 'test_session_001.2', // Delegate agent 2
      sessionId: 'test_session_001',
      createdAt: new Date('2025-09-19T10:02:00Z'),
      updatedAt: new Date('2025-09-19T10:02:00Z'),
      events: [],
    });

    // Add pending approvals across different agents

    // Agent 1 has a pending bash command
    const agent1ToolCall: LaceEvent = {
      id: 'evt_001',
      type: 'TOOL_CALL',
      timestamp: new Date('2025-09-19T10:03:00Z'),
      context: { threadId: 'test_session_001.1' },
      data: { id: 'tool_call_001', name: 'bash', arguments: { command: 'ls -la' } },
    };
    db.saveEvent(agent1ToolCall);

    const agent1ApprovalRequest: LaceEvent = {
      id: 'evt_002',
      type: 'TOOL_APPROVAL_REQUEST',
      timestamp: new Date('2025-09-19T10:03:01Z'),
      context: { threadId: 'test_session_001.1' },
      data: { toolCallId: 'tool_call_001' },
    };
    db.saveEvent(agent1ApprovalRequest);

    // Agent 2 has a pending file write
    const agent2ToolCall: LaceEvent = {
      id: 'evt_003',
      type: 'TOOL_CALL',
      timestamp: new Date('2025-09-19T10:04:00Z'),
      context: { threadId: 'test_session_001.2' },
      data: {
        id: 'tool_call_002',
        name: 'file_write',
        arguments: { path: '/tmp/test.txt', content: 'test' },
      },
    };
    db.saveEvent(agent2ToolCall);

    const agent2ApprovalRequest: LaceEvent = {
      id: 'evt_004',
      type: 'TOOL_APPROVAL_REQUEST',
      timestamp: new Date('2025-09-19T10:04:01Z'),
      context: { threadId: 'test_session_001.2' },
      data: { toolCallId: 'tool_call_002' },
    };
    db.saveEvent(agent2ApprovalRequest);

    // Coordinator has a completed approval (should not be returned)
    const coordinatorToolCall: LaceEvent = {
      id: 'evt_005',
      type: 'TOOL_CALL',
      timestamp: new Date('2025-09-19T10:05:00Z'),
      context: { threadId: 'test_session_001' },
      data: { id: 'tool_call_003', name: 'bash', arguments: { command: 'pwd' } },
    };
    db.saveEvent(coordinatorToolCall);

    const coordinatorApprovalRequest: LaceEvent = {
      id: 'evt_006',
      type: 'TOOL_APPROVAL_REQUEST',
      timestamp: new Date('2025-09-19T10:05:01Z'),
      context: { threadId: 'test_session_001' },
      data: { toolCallId: 'tool_call_003' },
    };
    db.saveEvent(coordinatorApprovalRequest);

    const coordinatorApprovalResponse: LaceEvent = {
      id: 'evt_007',
      type: 'TOOL_APPROVAL_RESPONSE',
      timestamp: new Date('2025-09-19T10:05:02Z'),
      context: { threadId: 'test_session_001' },
      data: { toolCallId: 'tool_call_003', decision: 'allow_once' },
    };
    db.saveEvent(coordinatorApprovalResponse);
  });

  it('should return all pending approvals for a session with single query', () => {
    // Query by session ID should return all pending approvals across all agents
    const sessionApprovals = db.getPendingApprovals('test_session_001');

    // Should find exactly 2 pending approvals (agent1 and agent2, not coordinator)
    expect(sessionApprovals).toHaveLength(2);

    // Sort by timestamp for consistent testing
    sessionApprovals.sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());

    // Verify first approval (from agent 1)
    expect(sessionApprovals[0].toolCallId).toBe('tool_call_001');
    expect(sessionApprovals[0].threadId).toBe('test_session_001.1');
    expect(sessionApprovals[0].toolCall).toEqual({
      id: 'tool_call_001',
      name: 'bash',
      arguments: { command: 'ls -la' },
    });

    // Verify second approval (from agent 2)
    expect(sessionApprovals[1].toolCallId).toBe('tool_call_002');
    expect(sessionApprovals[1].threadId).toBe('test_session_001.2');
    expect(sessionApprovals[1].toolCall).toEqual({
      id: 'tool_call_002',
      name: 'file_write',
      arguments: { path: '/tmp/test.txt', content: 'test' },
    });
  });

  it('should still work for individual thread queries', () => {
    // Original functionality should still work - query by thread ID
    const agent1Approvals = db.getPendingApprovals('test_session_001.1');
    expect(agent1Approvals).toHaveLength(1);
    expect(agent1Approvals[0].toolCallId).toBe('tool_call_001');

    const agent2Approvals = db.getPendingApprovals('test_session_001.2');
    expect(agent2Approvals).toHaveLength(1);
    expect(agent2Approvals[0].toolCallId).toBe('tool_call_002');

    const coordinatorApprovals = db.getPendingApprovals('test_session_001');
    // When queried as a thread ID (no session exists with this ID in our test),
    // it should return 0 since the coordinator's approval was responded to
    expect(coordinatorApprovals.filter((a) => a.threadId === 'test_session_001')).toHaveLength(0);
  });
});
