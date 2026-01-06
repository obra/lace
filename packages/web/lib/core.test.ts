// ABOUTME: Test unified core type imports
// ABOUTME: Ensures all expected types and functions are exported correctly

import { describe, it, expect } from 'vitest';
import type { ThreadId } from '@lace/web/types/core';
import { isThreadId, asThreadId, EVENT_TYPES, ApprovalDecision } from '@lace/web/types/core';
import { testSessionId } from '@lace/web/test-utils/test-ids';

describe('Core Type Imports', () => {
  it('should export ThreadId type correctly', () => {
    const validId = testSessionId(1);
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
});
