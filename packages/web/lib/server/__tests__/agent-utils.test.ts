// ABOUTME: Tests for agent-specific web utilities
// ABOUTME: Verifies agent tool approval setup and configuration

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupAgentApprovals } from '@/lib/server/agent-utils';
import { Agent } from '@/lib/server/lace-imports';
import { SessionService } from '@/lib/server/session-service';

// Mock the approval manager
vi.mock('@/lib/server/approval-manager', () => ({
  getApprovalManager: vi.fn(),
}));

describe('Agent Utilities', () => {
  let mockAgent: {
    on: ReturnType<typeof vi.fn>;
    threadId: string;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAgent = {
      on: vi.fn(),
      threadId: 'test-thread-id',
    };
  });

  it('should setup approval callback on agent', () => {
    const sessionId = 'test-session-id';

    setupAgentApprovals(mockAgent as unknown as Agent, sessionId);

    expect(mockAgent.on).toHaveBeenCalledWith('approval_request', expect.any(Function));
  });

  it('should not have setupApprovalCallback method in SessionService', () => {
    const sessionService = new SessionService();

    // This should FAIL initially because method still exists
    // Use type assertion to access potentially non-existent property
    expect(
      (sessionService as unknown as { setupApprovalCallback?: unknown }).setupApprovalCallback
    ).toBeUndefined();
  });

  it('should not have spawnAgent method in SessionService', () => {
    const sessionService = new SessionService();

    // This should FAIL initially because method still exists
    // Use type assertion to access potentially non-existent property
    expect((sessionService as unknown as { spawnAgent?: unknown }).spawnAgent).toBeUndefined();
  });

  it('should not have getAgent method in SessionService', () => {
    const sessionService = new SessionService();

    // This should FAIL initially because method still exists
    // Use type assertion to access potentially non-existent property
    expect((sessionService as unknown as { getAgent?: unknown }).getAgent).toBeUndefined();
  });
});
