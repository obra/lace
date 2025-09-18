// ABOUTME: Test for session-level approval decision endpoint
// ABOUTME: Routes approval decisions to the correct agent that created the tool call

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { action } from '../api.sessions.$sessionId.approvals.$toolCallId';
import { getSessionService } from '@/lib/server/session-service';
import type { Session } from '@lace/core/sessions/session';
import type { Agent } from '@lace/core/agents/agent';
import { asThreadId } from '@/types/core';

// Mock the session service
vi.mock('@/lib/server/session-service');
const mockGetSessionService = vi.mocked(getSessionService);

// Mock session and agents
const createMockAgent = (threadId: string, pendingApprovals: any[] = []) => {
  return {
    threadId,
    getPendingApprovals: vi.fn().mockReturnValue(pendingApprovals),
    handleApprovalResponse: vi.fn().mockResolvedValue(undefined),
  } as unknown as Agent;
};

const createMockSession = (sessionId: string, agents: Agent[] = []) => {
  return {
    getAgents: vi.fn().mockReturnValue(agents),
    getAgent: vi
      .fn()
      .mockImplementation((agentId: string) => agents.find((a) => a.threadId === agentId) || null),
  } as unknown as Session;
};

describe('/api/sessions/:sessionId/approvals/:toolCallId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should route approval decision to the correct agent', async () => {
    const sessionId = 'lace_20250916_test01';
    const toolCallId = 'tool-call-1';

    // Create mock agents - tool call came from agent2
    const agent1 = createMockAgent('lace_20250916_test01.1', []);
    const agent2 = createMockAgent('lace_20250916_test01.2', [
      {
        toolCallId: 'tool-call-1',
        toolCall: { name: 'file_write', arguments: {} },
        requestedAt: new Date('2023-01-01T10:00:00Z'),
      },
    ]);

    const mockSession = createMockSession(sessionId, [agent1, agent2]);

    const mockSessionService = {
      getSession: vi.fn().mockResolvedValue(mockSession),
    };
    mockGetSessionService.mockReturnValue(mockSessionService as any);

    const request = new Request(
      `http://localhost/api/sessions/${sessionId}/approvals/${toolCallId}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'allow_once' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const response = await action({
      request,
      params: { sessionId, toolCallId },
      context: {},
    } as any);

    expect(response.status).toBe(200);

    // Should call submitApprovalDecision on the correct agent (agent2)
    expect(agent2.handleApprovalResponse).toHaveBeenCalledWith('tool-call-1', 'allow_once');
    expect(agent1.handleApprovalResponse).not.toHaveBeenCalled();
  });

  it('should return 404 when tool call not found in any agent', async () => {
    const sessionId = 'lace_20250916_test01';
    const toolCallId = 'non-existent-tool-call';

    const agent1 = createMockAgent('lace_20250916_test01.1', []);
    const agent2 = createMockAgent('lace_20250916_test01.2', []);

    const mockSession = createMockSession(sessionId, [agent1, agent2]);

    const mockSessionService = {
      getSession: vi.fn().mockResolvedValue(mockSession),
    };
    mockGetSessionService.mockReturnValue(mockSessionService as any);

    const request = new Request(
      `http://localhost/api/sessions/${sessionId}/approvals/${toolCallId}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'allow_once' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const response = await action({
      request,
      params: { sessionId, toolCallId },
      context: {},
    } as any);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('should return 400 for invalid decision values', async () => {
    const sessionId = 'lace_20250916_test01';
    const toolCallId = 'tool-call-1';

    const request = new Request(
      `http://localhost/api/sessions/${sessionId}/approvals/${toolCallId}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'invalid-decision' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const response = await action({
      request,
      params: { sessionId, toolCallId },
      context: {},
    } as any);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 404 when session not found', async () => {
    const sessionId = 'lace_20250916_notfound';
    const toolCallId = 'tool-call-1';

    const mockSessionService = {
      getSession: vi.fn().mockResolvedValue(null),
    };
    mockGetSessionService.mockReturnValue(mockSessionService as any);

    const request = new Request(
      `http://localhost/api/sessions/${sessionId}/approvals/${toolCallId}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'allow_once' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const response = await action({
      request,
      params: { sessionId, toolCallId },
      context: {},
    } as any);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('should handle multiple pending approvals and find the right one', async () => {
    const sessionId = 'lace_20250916_test01';
    const toolCallId = 'tool-call-2';

    const agent1 = createMockAgent('lace_20250916_test01.1', [
      {
        toolCallId: 'tool-call-1',
        toolCall: { name: 'file_read', arguments: {} },
        requestedAt: new Date('2023-01-01T10:00:00Z'),
      },
    ]);

    const agent2 = createMockAgent('lace_20250916_test01.2', [
      {
        toolCallId: 'tool-call-2',
        toolCall: { name: 'file_write', arguments: {} },
        requestedAt: new Date('2023-01-01T10:01:00Z'),
      },
      {
        toolCallId: 'tool-call-3',
        toolCall: { name: 'bash', arguments: {} },
        requestedAt: new Date('2023-01-01T10:02:00Z'),
      },
    ]);

    const mockSession = createMockSession(sessionId, [agent1, agent2]);

    const mockSessionService = {
      getSession: vi.fn().mockResolvedValue(mockSession),
    };
    mockGetSessionService.mockReturnValue(mockSessionService as any);

    const request = new Request(
      `http://localhost/api/sessions/${sessionId}/approvals/${toolCallId}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'deny' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const response = await action({
      request,
      params: { sessionId, toolCallId },
      context: {},
    } as any);

    expect(response.status).toBe(200);

    // Should find tool-call-2 in agent2 and submit decision
    expect(agent2.handleApprovalResponse).toHaveBeenCalledWith('tool-call-2', 'deny');
    expect(agent1.handleApprovalResponse).not.toHaveBeenCalled();
  });
});
