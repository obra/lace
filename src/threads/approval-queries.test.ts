// ABOUTME: Tests for approval-related database queries
// ABOUTME: Validates pending approval queries and approval status checks

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabasePersistence } from '~/persistence/database';
import { ThreadEvent } from './types';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

describe('Approval Database Queries', () => {
  let db: DatabasePersistence;
  let threadId: string;

  beforeEach(() => {
    db = setupTestPersistence();
    threadId = 'test_thread_123';
    
    // Create a test thread
    db.saveThread({
      id: threadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      events: []
    });
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  describe('pending approvals query', () => {
    it('should find pending approvals with no responses', () => {
      // Create TOOL_CALL event
      const toolCallEvent: ThreadEvent = {
        id: 'event_1',
        threadId,
        type: 'TOOL_CALL',
        timestamp: new Date('2025-01-01T10:00:00Z'),
        data: { id: 'call_123', name: 'bash', arguments: { command: 'ls' } }
      };
      db.saveEvent(toolCallEvent);

      // Create TOOL_APPROVAL_REQUEST event
      const requestEvent: ThreadEvent = {
        id: 'event_2', 
        threadId,
        type: 'TOOL_APPROVAL_REQUEST',
        timestamp: new Date('2025-01-01T10:01:00Z'),
        data: { toolCallId: 'call_123' }
      };
      db.saveEvent(requestEvent);

      // Query should return the pending approval
      const pending = db.getPendingApprovals(threadId);
      expect(pending).toHaveLength(1);
      expect(pending[0].toolCallId).toBe('call_123');
      expect(pending[0].toolCall.name).toBe('bash');
    });

    it('should not return approvals that have responses', () => {
      // Create TOOL_CALL → TOOL_APPROVAL_REQUEST → TOOL_APPROVAL_RESPONSE
      db.saveEvent({
        id: 'event_1',
        threadId,
        type: 'TOOL_CALL',
        timestamp: new Date('2025-01-01T10:00:00Z'),
        data: { id: 'call_123', name: 'bash', arguments: { command: 'ls' } }
      });

      db.saveEvent({
        id: 'event_2',
        threadId, 
        type: 'TOOL_APPROVAL_REQUEST',
        timestamp: new Date('2025-01-01T10:01:00Z'),
        data: { toolCallId: 'call_123' }
      });

      db.saveEvent({
        id: 'event_3',
        threadId,
        type: 'TOOL_APPROVAL_RESPONSE', 
        timestamp: new Date('2025-01-01T10:02:00Z'),
        data: { toolCallId: 'call_123', decision: 'allow_once' }
      });

      // Should not return any pending approvals
      const pending = db.getPendingApprovals(threadId);
      expect(pending).toHaveLength(0);
    });

    it('should return multiple pending approvals ordered by timestamp', () => {
      // Create two TOOL_CALLs with pending approvals
      ['call_1', 'call_2'].forEach((callId, index) => {
        db.saveEvent({
          id: `tool_event_${index + 1}`,
          threadId,
          type: 'TOOL_CALL',
          timestamp: new Date(`2025-01-01T10:0${index}:00Z`),
          data: { id: callId, name: 'bash', arguments: { command: 'ls' } }
        });

        db.saveEvent({
          id: `request_event_${index + 1}`,
          threadId,
          type: 'TOOL_APPROVAL_REQUEST', 
          timestamp: new Date(`2025-01-01T10:0${index + 1}:00Z`),
          data: { toolCallId: callId }
        });
      });

      const pending = db.getPendingApprovals(threadId);
      expect(pending).toHaveLength(2);
      expect(pending[0].toolCallId).toBe('call_1'); // Earlier timestamp first
      expect(pending[1].toolCallId).toBe('call_2');
    });
  });

  describe('approval status check', () => {
    it('should return approval decision when response exists', () => {
      // Create TOOL_APPROVAL_RESPONSE event
      db.saveEvent({
        id: 'event_1',
        threadId,
        type: 'TOOL_APPROVAL_RESPONSE',
        timestamp: new Date(),
        data: { toolCallId: 'call_123', decision: 'allow_session' }
      });

      const decision = db.getApprovalDecision('call_123');
      expect(decision).toBe('allow_session');
    });

    it('should return null when no response exists', () => {
      const decision = db.getApprovalDecision('nonexistent_call');
      expect(decision).toBeNull();
    });
  });
});