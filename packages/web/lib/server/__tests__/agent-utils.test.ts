// ABOUTME: Tests for agent-specific web utilities
// ABOUTME: Verifies agent tool approval setup and configuration

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupAgentApprovals } from '../agent-utils';
import { Agent } from '@/lib/server/lace-imports';
import { SessionService } from '../session-service';

// Mock the approval manager
vi.mock('../approval-manager', () => ({
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
    expect((sessionService as any).setupApprovalCallback).toBeUndefined();
  });
});
