// ABOUTME: Test for session-wide approval aggregation API
// ABOUTME: Ensures all pending approvals from all agents in a session are collected and returned

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRemixStub } from '@remix-run/testing';
import { loader } from '../api.sessions.$sessionId.approvals.pending';
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
    toolExecutor: {
      getTool: vi.fn().mockImplementation((toolName: string) => {
        // Return different tool configs for testing
        if (toolName === 'file_write') {
          return {
            description: 'Write content to a file',
            annotations: { destructiveHint: true },
          };
        }
        if (toolName === 'file_read') {
          return {
            description: 'Read file contents',
            annotations: { readOnlyHint: true },
          };
        }
        return {
          description: `${toolName} tool`,
          annotations: {},
        };
      }),
    },
  } as unknown as Agent;
};

const createMockSession = (sessionId: string, agents: Agent[] = []) => {
  return {
    getAgents: vi.fn().mockReturnValue(agents),
  } as unknown as Session;
};

describe('/api/sessions/:sessionId/approvals/pending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array when session has no agents', async () => {
    const sessionId = 'lace_20250916_test01';
    const mockSession = createMockSession(sessionId, []);

    const mockSessionService = {
      getSession: vi.fn().mockResolvedValue(mockSession),
    };
    mockGetSessionService.mockReturnValue(mockSessionService as any);

    const request = new Request(`http://localhost/api/sessions/${sessionId}/approvals/pending`);
    const response = await loader({
      request,
      params: { sessionId },
      context: {},
    } as any);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.json).toEqual([]);
  });

  it('should aggregate pending approvals from multiple agents in a session', async () => {
    const sessionId = 'lace_20250916_test02';

    // Create mock agents with pending approvals
    const agent1 = createMockAgent('lace_20250916_test02.1', [
      {
        toolCallId: 'tool-call-1',
        toolCall: { name: 'file_write', arguments: { path: '/test.txt', content: 'hello' } },
        requestedAt: new Date('2023-01-01T10:00:00Z'),
      },
    ]);

    const agent2 = createMockAgent('lace_20250916_test02.2', [
      {
        toolCallId: 'tool-call-2',
        toolCall: { name: 'file_read', arguments: { path: '/readme.md' } },
        requestedAt: new Date('2023-01-01T10:01:00Z'),
      },
      {
        toolCallId: 'tool-call-3',
        toolCall: { name: 'bash', arguments: { command: 'ls -la' } },
        requestedAt: new Date('2023-01-01T09:59:00Z'),
      },
    ]);

    const mockSession = createMockSession(sessionId, [agent1, agent2]);

    const mockSessionService = {
      getSession: vi.fn().mockResolvedValue(mockSession),
    };
    mockGetSessionService.mockReturnValue(mockSessionService as any);

    const request = new Request(`http://localhost/api/sessions/${sessionId}/approvals/pending`);
    const response = await loader({
      request,
      params: { sessionId },
      context: {},
    } as any);

    expect(response.status).toBe(200);
    const data = await response.json();
    const approvals = data.json;

    // Should have 3 total approvals
    expect(approvals).toHaveLength(3);

    // Should be sorted by requestedAt (oldest first)
    expect(approvals[0].toolCallId).toBe('tool-call-3'); // 09:59
    expect(approvals[1].toolCallId).toBe('tool-call-1'); // 10:00
    expect(approvals[2].toolCallId).toBe('tool-call-2'); // 10:01

    // Should include agent context for each approval
    expect(approvals[0].agentId).toBe('lace_20250916_test02.2');
    expect(approvals[1].agentId).toBe('lace_20250916_test02.1');
    expect(approvals[2].agentId).toBe('lace_20250916_test02.2');

    // Should include tool metadata
    expect(approvals[0].requestData.toolName).toBe('bash');
    expect(approvals[0].requestData.riskLevel).toBe('moderate');

    expect(approvals[1].requestData.toolName).toBe('file_write');
    expect(approvals[1].requestData.riskLevel).toBe('destructive');

    expect(approvals[2].requestData.toolName).toBe('file_read');
    expect(approvals[2].requestData.riskLevel).toBe('safe');
  });

  it('should handle agents with no pending approvals', async () => {
    const sessionId = 'lace_20250916_test03';

    const agent1 = createMockAgent('lace_20250916_test03.1', []); // No pending approvals
    const agent2 = createMockAgent('lace_20250916_test03.2', [
      {
        toolCallId: 'tool-call-1',
        toolCall: { name: 'file_list', arguments: {} },
        requestedAt: new Date('2023-01-01T10:00:00Z'),
      },
    ]);

    const mockSession = createMockSession(sessionId, [agent1, agent2]);

    const mockSessionService = {
      getSession: vi.fn().mockResolvedValue(mockSession),
    };
    mockGetSessionService.mockReturnValue(mockSessionService as any);

    const request = new Request(`http://localhost/api/sessions/${sessionId}/approvals/pending`);
    const response = await loader({
      request,
      params: { sessionId },
      context: {},
    } as any);

    expect(response.status).toBe(200);
    const data = await response.json();
    const approvals = data.json;

    // Should only have 1 approval from agent2
    expect(approvals).toHaveLength(1);
    expect(approvals[0].agentId).toBe('lace_20250916_test03.2');
    expect(approvals[0].toolCallId).toBe('tool-call-1');
  });

  it('should return 404 when session not found', async () => {
    const sessionId = 'lace_20250916_notfound';

    const mockSessionService = {
      getSession: vi.fn().mockResolvedValue(null),
    };
    mockGetSessionService.mockReturnValue(mockSessionService as any);

    const request = new Request(`http://localhost/api/sessions/${sessionId}/approvals/pending`);
    const response = await loader({
      request,
      params: { sessionId },
      context: {},
    } as any);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('should handle errors from individual agents gracefully', async () => {
    const sessionId = 'lace_20250916_test04';

    // Agent 1 works fine
    const agent1 = createMockAgent('lace_20250916_test04.1', [
      {
        toolCallId: 'tool-call-1',
        toolCall: { name: 'file_read', arguments: { path: '/test.txt' } },
        requestedAt: new Date('2023-01-01T10:00:00Z'),
      },
    ]);

    // Agent 2 throws error
    const agent2 = createMockAgent('lace_20250916_test04.2', []);
    agent2.getPendingApprovals = vi.fn().mockImplementation(() => {
      throw new Error('Agent error');
    });

    const mockSession = createMockSession(sessionId, [agent1, agent2]);

    const mockSessionService = {
      getSession: vi.fn().mockResolvedValue(mockSession),
    };
    mockGetSessionService.mockReturnValue(mockSessionService as any);

    const request = new Request(`http://localhost/api/sessions/${sessionId}/approvals/pending`);
    const response = await loader({
      request,
      params: { sessionId },
      context: {},
    } as any);

    expect(response.status).toBe(200);
    const data = await response.json();
    const approvals = data.json;

    // Should still return approvals from agent1 despite agent2 error
    expect(approvals).toHaveLength(1);
    expect(approvals[0].agentId).toBe('lace_20250916_test04.1');
  });
});
