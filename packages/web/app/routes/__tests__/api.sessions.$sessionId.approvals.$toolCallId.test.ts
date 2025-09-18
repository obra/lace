// ABOUTME: Test for session-level approval decision endpoint
// ABOUTME: Routes approval decisions to the correct agent that created the tool call

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { action } from '@/app/routes/api.sessions.$sessionId.approvals.$toolCallId';
import { getSessionService } from '@/lib/server/session-service';
import { parseResponse } from '@/lib/serialization';
import { createActionArgs } from '@/test-utils/route-test-helpers';
import type { Session } from '@lace/core/sessions/session';
import type { Agent } from '@lace/core/agents/agent';
import type { PendingApproval, ApiErrorResponse } from '@/types/api';
import type { SessionService } from '@/lib/server/session-service';
import type { ToolApprovalRequestData } from '@/types/web-events';

// Mock the session service
vi.mock('@/lib/server/session-service');
const mockGetSessionService = vi.mocked(getSessionService);

// Mock session and agents
const createMockAgent = (threadId: string, pendingApprovals: PendingApproval[] = []) => {
  return {
    threadId,
    getPendingApprovals: vi.fn().mockReturnValue(pendingApprovals),
    handleApprovalResponse: vi.fn().mockResolvedValue(undefined),
  } as unknown as Agent;
};

const createMockRequestData = (): ToolApprovalRequestData => ({
  requestId: 'request-1',
  toolName: 'file_write',
  input: {},
  isReadOnly: false,
  riskLevel: 'moderate',
  toolDescription: 'Test tool',
  toolAnnotations: {},
});

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
        requestData: createMockRequestData(),
      },
    ]);

    const mockSession = createMockSession(sessionId, [agent1, agent2]);

    const mockSessionService = {
      getSession: vi.fn().mockResolvedValue(mockSession),
      setupAgentEventHandlers: vi.fn().mockResolvedValue(undefined),
      updateSession: vi.fn().mockResolvedValue(undefined),
      clearActiveSessions: vi.fn(),
    } as SessionService;
    mockGetSessionService.mockReturnValue(mockSessionService);

    const request = new Request(
      `http://localhost/api/sessions/${sessionId}/approvals/${toolCallId}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'allow_once' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const response = await action(createActionArgs(request, { sessionId, toolCallId }));
    const data = await parseResponse(response);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

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
      setupAgentEventHandlers: vi.fn().mockResolvedValue(undefined),
      updateSession: vi.fn().mockResolvedValue(undefined),
      clearActiveSessions: vi.fn(),
    } as SessionService;
    mockGetSessionService.mockReturnValue(mockSessionService);

    const request = new Request(
      `http://localhost/api/sessions/${sessionId}/approvals/${toolCallId}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'allow_once' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const response = await action(createActionArgs(request, { sessionId, toolCallId }));
    const data = await parseResponse<ApiErrorResponse>(response);

    expect(response.status).toBe(404);
    expect(data.code).toBe('RESOURCE_NOT_FOUND');
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

    const response = await action(createActionArgs(request, { sessionId, toolCallId }));
    const data = await parseResponse<ApiErrorResponse>(response);

    expect(response.status).toBe(400);
    expect(data.code).toBe('VALIDATION_ERROR');
  });

  it('should return 404 when session not found', async () => {
    const sessionId = 'lace_20250916_nofind'; // Valid format but non-existent
    const toolCallId = 'tool-call-1';

    const mockSessionService = {
      getSession: vi.fn().mockResolvedValue(null),
    };
    mockGetSessionService.mockReturnValue(mockSessionService as SessionService);

    const request = new Request(
      `http://localhost/api/sessions/${sessionId}/approvals/${toolCallId}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'allow_once' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const response = await action(createActionArgs(request, { sessionId, toolCallId }));
    const data = await parseResponse<ApiErrorResponse>(response);

    expect(response.status).toBe(404);
    expect(data.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('should handle multiple pending approvals and find the right one', async () => {
    const sessionId = 'lace_20250916_test01';
    const toolCallId = 'tool-call-2';

    const agent1 = createMockAgent('lace_20250916_test01.1', [
      {
        toolCallId: 'tool-call-1',
        toolCall: { name: 'file_read', arguments: {} },
        requestedAt: new Date('2023-01-01T10:00:00Z'),
        requestData: createMockRequestData(),
      },
    ]);

    const agent2 = createMockAgent('lace_20250916_test01.2', [
      {
        toolCallId: 'tool-call-2',
        toolCall: { name: 'file_write', arguments: {} },
        requestedAt: new Date('2023-01-01T10:01:00Z'),
        requestData: createMockRequestData(),
      },
      {
        toolCallId: 'tool-call-3',
        toolCall: { name: 'bash', arguments: {} },
        requestedAt: new Date('2023-01-01T10:02:00Z'),
        requestData: createMockRequestData(),
      },
    ]);

    const mockSession = createMockSession(sessionId, [agent1, agent2]);

    const mockSessionService = {
      getSession: vi.fn().mockResolvedValue(mockSession),
      setupAgentEventHandlers: vi.fn().mockResolvedValue(undefined),
      updateSession: vi.fn().mockResolvedValue(undefined),
      clearActiveSessions: vi.fn(),
    } as SessionService;
    mockGetSessionService.mockReturnValue(mockSessionService);

    const request = new Request(
      `http://localhost/api/sessions/${sessionId}/approvals/${toolCallId}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'deny' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const response = await action(createActionArgs(request, { sessionId, toolCallId }));
    const data = await parseResponse<{
      success: boolean;
      agentId: string;
      toolCallId: string;
      decision: string;
    }>(response);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    // Should find tool-call-2 in agent2 and submit decision
    expect(agent2.handleApprovalResponse).toHaveBeenCalledWith('tool-call-2', 'deny');
    expect(agent1.handleApprovalResponse).not.toHaveBeenCalled();
  });
});
