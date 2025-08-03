// ABOUTME: Test unified core type imports
// ABOUTME: Ensures all expected types and functions are exported correctly

import { describe, it, expect } from 'vitest';
import type { ThreadId, Task } from '@/types/core';
import { isThreadId, asThreadId, EVENT_TYPES, ApprovalDecision } from '@/types/core';

describe('Core Type Imports', () => {
  it('should export ThreadId type correctly', () => {
    const validId = 'lace_20250731_abc123';
    expect(isThreadId(validId)).toBe(true);

    const threadId: ThreadId = asThreadId(validId);
    expect(threadId).toBe(validId);
  });

  it('should export ApprovalDecision enum', () => {
    expect(ApprovalDecision.ALLOW_ONCE).toBe('allow_once');
    expect(ApprovalDecision.ALLOW_SESSION).toBe('allow_session');
    expect(ApprovalDecision.DENY).toBe('deny');
  });

  it('should export EVENT_TYPES constant', () => {
    expect(EVENT_TYPES).toContain('USER_MESSAGE');
    expect(EVENT_TYPES).toContain('AGENT_MESSAGE');
    expect(EVENT_TYPES).toContain('TOOL_CALL');
  });

  it('should export Task types', () => {
    // This test verifies the type exists by using it
    const task: Partial<Task> = {
      title: 'Test task',
      status: 'pending',
    };
    expect(task.title).toBe('Test task');
  });
});
