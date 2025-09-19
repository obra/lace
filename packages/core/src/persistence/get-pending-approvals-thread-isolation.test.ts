// ABOUTME: Test for thread isolation fix in getPendingApprovals SQL query using real data
// ABOUTME: Uses actual events from Jesse's database to reproduce and verify the thread isolation bug fix

import { describe, it, expect, beforeEach } from 'vitest';
import { DatabasePersistence, getPersistence } from './database';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import type { LaceEvent } from '~/threads/types';

describe('getPendingApprovals Thread Isolation Bug Fix (Real Data)', () => {
  const _tempLaceDir = setupCoreTest();
  let db: DatabasePersistence;

  beforeEach(() => {
    db = getPersistence();

    // Create the threads first (required for foreign key constraints)
    db.saveThread({
      id: 'lace_20250824_phdj9z',
      createdAt: new Date('2025-08-31T15:17:00Z'),
      updatedAt: new Date('2025-08-31T15:17:00Z'),
      events: [],
    });

    db.saveThread({
      id: 'lace_20250919_xj47qn',
      createdAt: new Date('2025-09-19T01:12:40Z'),
      updatedAt: new Date('2025-09-19T01:12:40Z'),
      events: [],
    });

    // Insert the real events from Jesse's database that demonstrate the thread isolation scenario

    // 1. Old thread (lace_20250824_phdj9z) with completed approval workflow
    const oldToolCall: LaceEvent = {
      id: 'evt_1756653427634_sr5oj52z7',
      type: 'TOOL_CALL',
      timestamp: new Date('2025-08-31T15:17:07.634Z'),
      context: { threadId: 'lace_20250824_phdj9z' },
      data: { id: 'functions.bash:0', name: 'bash', arguments: { command: 'ls -la' } },
    };
    db.saveEvent(oldToolCall);

    const oldApprovalRequest: LaceEvent = {
      id: 'evt_1756653427636_00kt1spmw',
      type: 'TOOL_APPROVAL_REQUEST',
      timestamp: new Date('2025-08-31T15:17:07.636Z'),
      context: { threadId: 'lace_20250824_phdj9z' },
      data: { toolCallId: 'functions.bash:0' },
    };
    db.saveEvent(oldApprovalRequest);

    const oldApprovalResponse: LaceEvent = {
      id: 'evt_1756653453463_mv6wj5pa5',
      type: 'TOOL_APPROVAL_RESPONSE',
      timestamp: new Date('2025-08-31T15:17:33.463Z'),
      context: { threadId: 'lace_20250824_phdj9z' },
      data: { toolCallId: 'functions.bash:0', decision: 'allow_once' },
    };
    db.saveEvent(oldApprovalResponse);

    // 2. Current thread (lace_20250919_xj47qn) with pending approval (same tool call ID!)
    const currentToolCall: LaceEvent = {
      id: 'evt_1758244366922_fbjkww2l3',
      type: 'TOOL_CALL',
      timestamp: new Date('2025-09-19T01:12:46.922Z'),
      context: { threadId: 'lace_20250919_xj47qn' },
      data: { id: 'functions.bash:0', name: 'bash', arguments: { command: 'ls /etc' } },
    };
    db.saveEvent(currentToolCall);

    const currentApprovalRequest: LaceEvent = {
      id: 'evt_1758244366922_4fav54bgy',
      type: 'TOOL_APPROVAL_REQUEST',
      timestamp: new Date('2025-09-19T01:12:46.922Z'),
      context: { threadId: 'lace_20250919_xj47qn' },
      data: { toolCallId: 'functions.bash:0' },
    };
    db.saveEvent(currentApprovalRequest);
  });

  it('should find pending approval in current thread (prevents regression)', () => {
    // Critical test: Current thread should find its pending approval
    // even when other threads have completed workflows with same tool call IDs
    const currentPendingApprovals = db.getPendingApprovals('lace_20250919_xj47qn');

    // Must find the pending approval in current thread
    expect(currentPendingApprovals).toHaveLength(1);
    expect(currentPendingApprovals[0].toolCallId).toBe('functions.bash:0');
    expect(currentPendingApprovals[0].threadId).toBe('lace_20250919_xj47qn');
    expect(currentPendingApprovals[0].toolCall).toEqual({
      id: 'functions.bash:0',
      name: 'bash',
      arguments: { command: 'ls /etc' },
    });
  });

  it('should correctly exclude approvals when response exists in same thread', () => {
    // Old thread has completed approval workflow - should have 0 pending
    const oldPendingApprovals = db.getPendingApprovals('lace_20250824_phdj9z');

    expect(oldPendingApprovals).toHaveLength(0);
  });

  it('should maintain thread isolation for approval workflows', () => {
    // Regression test: Ensure threads don't interfere with each other's approval state

    // Current thread: has pending request, no response
    const currentApprovals = db.getPendingApprovals('lace_20250919_xj47qn');
    expect(currentApprovals).toHaveLength(1);

    // Old thread: has both request and response, so no pending
    const oldApprovals = db.getPendingApprovals('lace_20250824_phdj9z');
    expect(oldApprovals).toHaveLength(0);

    // Each thread's approval state is isolated despite shared tool call IDs
  });
});
