// ABOUTME: Tests for approval route handlers that abstract session vs thread scoped approvals
// ABOUTME: Verifies correct behavior for getting pending approvals and submitting decisions

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the dependencies before importing the module under test
vi.mock('@lace/web/lib/server/supervisor-service', () => ({
  getSupervisor: vi.fn(),
  listPendingPermissions: vi.fn(),
  resolvePendingPermission: vi.fn(),
}));

// Import after mocking
import {
  getPendingApprovals,
  submitApprovalDecision,
  transformPendingApproval,
  ApprovalDecisionSchema,
  type ApprovalContext,
} from './approval-route-handlers';
import {
  getSupervisor,
  listPendingPermissions,
  resolvePendingPermission,
} from '@lace/web/lib/server/supervisor-service';
import { RouteValidationError } from './route-helpers';
import type { PendingPermission } from '@lace/supervisor';

const mockGetSupervisor = vi.mocked(getSupervisor);
const mockListPendingPermissions = vi.mocked(listPendingPermissions);
const mockResolvePendingPermission = vi.mocked(resolvePendingPermission);

/**
 * Creates a minimal mock PendingPermission for testing.
 * The actual type has more fields on the request object, but we only use
 * a subset in our handler logic (tool, kind, resource, options).
 */
function createMockPendingPermission(
  overrides: Partial<PendingPermission> & {
    agentSessionId: string;
    toolCallId: string;
  }
): PendingPermission {
  return {
    workspaceSessionId: 'ws_test-session',
    toolCall: { name: 'file_write', arguments: {} },
    requestedAt: '2024-01-15T10:00:00.000Z',
    // Cast the request to satisfy TypeScript - we only access a subset of fields
    request: { tool: 'file_write', kind: 'write', resource: '/test.txt', options: [] },
    ...overrides,
  } as PendingPermission;
}

describe('Approval Route Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ApprovalDecisionSchema', () => {
    it('accepts allow_once', () => {
      const result = ApprovalDecisionSchema.safeParse({ decision: 'allow_once' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.decision).toBe('allow_once');
      }
    });

    it('accepts allow_session', () => {
      const result = ApprovalDecisionSchema.safeParse({ decision: 'allow_session' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.decision).toBe('allow_session');
      }
    });

    it('accepts deny', () => {
      const result = ApprovalDecisionSchema.safeParse({ decision: 'deny' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.decision).toBe('deny');
      }
    });

    it('rejects invalid decision', () => {
      const result = ApprovalDecisionSchema.safeParse({ decision: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects missing decision', () => {
      const result = ApprovalDecisionSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('transformPendingApproval', () => {
    const basePendingPermission = createMockPendingPermission({
      agentSessionId: 'as_test-agent',
      toolCallId: 'tool-call-123',
      toolCall: { name: 'file_write', arguments: { path: '/test.txt' } },
    });

    it('transforms pending permission to approval format', () => {
      const result = transformPendingApproval(basePendingPermission);

      expect(result.toolCallId).toBe('tool-call-123');
      expect(result.toolCall.name).toBe('file_write');
      expect(result.toolCall.arguments).toEqual({ path: '/test.txt' });
      expect(result.requestedAt).toBeInstanceOf(Date);
      expect(result.requestData.requestId).toBe('tool-call-123');
      expect(result.requestData.toolName).toBe('file_write');
      expect(result.requestData.input).toEqual({ path: '/test.txt' });
      expect(result.requestData.isReadOnly).toBe(false);
      expect(result.requestData.riskLevel).toBe('moderate');
    });

    it('includes agentId when includeAgentId is true', () => {
      const result = transformPendingApproval(basePendingPermission, true);

      expect(result.agentId).toBe('as_test-agent');
    });

    it('does not include agentId when includeAgentId is false', () => {
      const result = transformPendingApproval(basePendingPermission, false);

      expect(result.agentId).toBeUndefined();
    });

    it('falls back to request.tool when toolCall.name is missing', () => {
      const permissionWithoutToolCallName = createMockPendingPermission({
        agentSessionId: 'as_test-agent',
        toolCallId: 'tool-call-123',
        toolCall: undefined,
      });

      const result = transformPendingApproval(permissionWithoutToolCallName);

      expect(result.toolCall.name).toBe('file_write');
    });

    it('uses empty string when neither toolCall.name nor request.tool available', () => {
      const permissionWithoutNames = {
        ...createMockPendingPermission({
          agentSessionId: 'as_test-agent',
          toolCallId: 'tool-call-123',
          toolCall: undefined,
        }),
        request: { tool: '', kind: 'write', resource: '/test.txt', options: [] },
      } as unknown as PendingPermission;

      const result = transformPendingApproval(permissionWithoutNames);

      expect(result.toolCall.name).toBe('');
    });
  });

  describe('getPendingApprovals', () => {
    describe('session scope', () => {
      const sessionContext: ApprovalContext = {
        scope: 'session',
        workspaceSessionId: 'ws_test-session',
      };

      it('throws RouteValidationError when session not found', async () => {
        const mockSupervisor = {
          getWorkspaceSession: vi.fn().mockResolvedValue(null),
        };
        mockGetSupervisor.mockResolvedValue(mockSupervisor as never);

        await expect(getPendingApprovals(sessionContext)).rejects.toThrow(RouteValidationError);
        await expect(getPendingApprovals(sessionContext)).rejects.toThrow('Session not found');
      });

      it('returns empty array when no pending approvals', async () => {
        const mockSupervisor = {
          getWorkspaceSession: vi.fn().mockResolvedValue({ workspaceSessionId: 'ws_test-session' }),
        };
        mockGetSupervisor.mockResolvedValue(mockSupervisor as never);
        mockListPendingPermissions.mockResolvedValue([]);

        const result = await getPendingApprovals(sessionContext);

        expect(result).toEqual([]);
      });

      it('returns all pending approvals with agentId included', async () => {
        const mockSupervisor = {
          getWorkspaceSession: vi.fn().mockResolvedValue({ workspaceSessionId: 'ws_test-session' }),
        };
        mockGetSupervisor.mockResolvedValue(mockSupervisor as never);

        const pendingPermissions: PendingPermission[] = [
          createMockPendingPermission({
            agentSessionId: 'as_agent1',
            toolCallId: 'tool-1',
            toolCall: { name: 'file_write', arguments: { path: '/a.txt' } },
          }),
          createMockPendingPermission({
            agentSessionId: 'as_agent2',
            toolCallId: 'tool-2',
            toolCall: { name: 'bash', arguments: { command: 'rm -rf /' } },
          }),
        ];
        mockListPendingPermissions.mockResolvedValue(pendingPermissions);

        const result = await getPendingApprovals(sessionContext);

        expect(result).toHaveLength(2);
        // Session scope returns SessionPendingApproval[] with agentId
        const sessionApprovals = result as Array<{ agentId?: string; toolCallId: string }>;
        expect(sessionApprovals[0].agentId).toBe('as_agent1');
        expect(sessionApprovals[1].agentId).toBe('as_agent2');
        expect(sessionApprovals[0].toolCallId).toBe('tool-1');
        expect(sessionApprovals[1].toolCallId).toBe('tool-2');
      });
    });

    describe('thread scope', () => {
      const threadContext: ApprovalContext = {
        scope: 'thread',
        threadId: 'as_test-agent',
      };

      it('throws RouteValidationError when agent not found', async () => {
        const mockSupervisor = {
          listWorkspaceSessions: vi.fn().mockResolvedValue([]),
        };
        mockGetSupervisor.mockResolvedValue(mockSupervisor as never);

        await expect(getPendingApprovals(threadContext)).rejects.toThrow(RouteValidationError);
        await expect(getPendingApprovals(threadContext)).rejects.toThrow('Agent not found');
      });

      it('returns only approvals for the specific thread/agent', async () => {
        const mockSupervisor = {
          listWorkspaceSessions: vi.fn().mockResolvedValue([
            {
              workspaceSessionId: 'ws_test-session',
              agents: [{ sessionId: 'as_test-agent' }, { sessionId: 'as_other-agent' }],
            },
          ]),
        };
        mockGetSupervisor.mockResolvedValue(mockSupervisor as never);

        const pendingPermissions: PendingPermission[] = [
          createMockPendingPermission({
            agentSessionId: 'as_test-agent',
            toolCallId: 'tool-1',
            toolCall: { name: 'file_write', arguments: { path: '/a.txt' } },
          }),
          createMockPendingPermission({
            agentSessionId: 'as_other-agent',
            toolCallId: 'tool-2',
            toolCall: { name: 'bash', arguments: { command: 'ls' } },
          }),
        ];
        mockListPendingPermissions.mockResolvedValue(pendingPermissions);

        const result = await getPendingApprovals(threadContext);

        expect(result).toHaveLength(1);
        expect(result[0].toolCallId).toBe('tool-1');
        // Thread scope does not include agentId
        const threadApproval = result[0] as { agentId?: string; toolCallId: string };
        expect(threadApproval.agentId).toBeUndefined();
      });

      it('returns empty array when agent has no pending approvals', async () => {
        const mockSupervisor = {
          listWorkspaceSessions: vi.fn().mockResolvedValue([
            {
              workspaceSessionId: 'ws_test-session',
              agents: [{ sessionId: 'as_test-agent' }],
            },
          ]),
        };
        mockGetSupervisor.mockResolvedValue(mockSupervisor as never);
        mockListPendingPermissions.mockResolvedValue([]);

        const result = await getPendingApprovals(threadContext);

        expect(result).toEqual([]);
      });
    });
  });

  describe('submitApprovalDecision', () => {
    describe('session scope', () => {
      const sessionContext: ApprovalContext = {
        scope: 'session',
        workspaceSessionId: 'ws_test-session',
      };

      it('throws RouteValidationError when session not found', async () => {
        const mockSupervisor = {
          getWorkspaceSession: vi.fn().mockResolvedValue(null),
        };
        mockGetSupervisor.mockResolvedValue(mockSupervisor as never);

        await expect(
          submitApprovalDecision(sessionContext, 'tool-1', 'allow_once')
        ).rejects.toThrow(RouteValidationError);
        await expect(
          submitApprovalDecision(sessionContext, 'tool-1', 'allow_once')
        ).rejects.toThrow('Session not found');
      });

      it('throws RouteValidationError when tool call not found', async () => {
        const mockSupervisor = {
          getWorkspaceSession: vi.fn().mockResolvedValue({ workspaceSessionId: 'ws_test-session' }),
        };
        mockGetSupervisor.mockResolvedValue(mockSupervisor as never);
        mockListPendingPermissions.mockResolvedValue([]);

        await expect(
          submitApprovalDecision(sessionContext, 'nonexistent', 'allow_once')
        ).rejects.toThrow(RouteValidationError);
        await expect(
          submitApprovalDecision(sessionContext, 'nonexistent', 'allow_once')
        ).rejects.toThrow('Tool call not found');
      });

      it('throws RouteValidationError when multiple matching tool calls (ambiguous)', async () => {
        const mockSupervisor = {
          getWorkspaceSession: vi.fn().mockResolvedValue({ workspaceSessionId: 'ws_test-session' }),
        };
        mockGetSupervisor.mockResolvedValue(mockSupervisor as never);
        mockListPendingPermissions.mockResolvedValue([
          createMockPendingPermission({
            agentSessionId: 'as_agent1',
            toolCallId: 'tool-1',
          }),
          createMockPendingPermission({
            agentSessionId: 'as_agent2',
            toolCallId: 'tool-1', // Same tool call ID
          }),
        ]);

        await expect(
          submitApprovalDecision(sessionContext, 'tool-1', 'allow_once')
        ).rejects.toThrow(RouteValidationError);
        await expect(
          submitApprovalDecision(sessionContext, 'tool-1', 'allow_once')
        ).rejects.toThrow('Tool call is ambiguous');
      });

      it('resolves pending permission with allow for allow_once', async () => {
        const mockSupervisor = {
          getWorkspaceSession: vi.fn().mockResolvedValue({ workspaceSessionId: 'ws_test-session' }),
        };
        mockGetSupervisor.mockResolvedValue(mockSupervisor as never);
        mockListPendingPermissions.mockResolvedValue([
          createMockPendingPermission({
            agentSessionId: 'as_agent1',
            toolCallId: 'tool-1',
          }),
        ]);
        mockResolvePendingPermission.mockResolvedValue(true);

        const result = await submitApprovalDecision(sessionContext, 'tool-1', 'allow_once');

        expect(mockResolvePendingPermission).toHaveBeenCalledWith({
          workspaceSessionId: 'ws_test-session',
          toolCallId: 'tool-1',
          decision: 'allow',
        });
        expect(result).toEqual({ success: true, toolCallId: 'tool-1', decision: 'allow_once' });
      });

      it('resolves pending permission with allow for allow_session', async () => {
        const mockSupervisor = {
          getWorkspaceSession: vi.fn().mockResolvedValue({ workspaceSessionId: 'ws_test-session' }),
        };
        mockGetSupervisor.mockResolvedValue(mockSupervisor as never);
        mockListPendingPermissions.mockResolvedValue([
          createMockPendingPermission({
            agentSessionId: 'as_agent1',
            toolCallId: 'tool-1',
          }),
        ]);
        mockResolvePendingPermission.mockResolvedValue(true);

        const result = await submitApprovalDecision(sessionContext, 'tool-1', 'allow_session');

        expect(mockResolvePendingPermission).toHaveBeenCalledWith({
          workspaceSessionId: 'ws_test-session',
          toolCallId: 'tool-1',
          decision: 'allow',
        });
        expect(result).toEqual({ success: true, toolCallId: 'tool-1', decision: 'allow_session' });
      });

      it('resolves pending permission with deny for deny', async () => {
        const mockSupervisor = {
          getWorkspaceSession: vi.fn().mockResolvedValue({ workspaceSessionId: 'ws_test-session' }),
        };
        mockGetSupervisor.mockResolvedValue(mockSupervisor as never);
        mockListPendingPermissions.mockResolvedValue([
          createMockPendingPermission({
            agentSessionId: 'as_agent1',
            toolCallId: 'tool-1',
          }),
        ]);
        mockResolvePendingPermission.mockResolvedValue(true);

        const result = await submitApprovalDecision(sessionContext, 'tool-1', 'deny');

        expect(mockResolvePendingPermission).toHaveBeenCalledWith({
          workspaceSessionId: 'ws_test-session',
          toolCallId: 'tool-1',
          decision: 'deny',
        });
        expect(result).toEqual({ success: true, toolCallId: 'tool-1', decision: 'deny' });
      });

      it('throws RouteValidationError when resolution fails', async () => {
        const mockSupervisor = {
          getWorkspaceSession: vi.fn().mockResolvedValue({ workspaceSessionId: 'ws_test-session' }),
        };
        mockGetSupervisor.mockResolvedValue(mockSupervisor as never);
        mockListPendingPermissions.mockResolvedValue([
          createMockPendingPermission({
            agentSessionId: 'as_agent1',
            toolCallId: 'tool-1',
          }),
        ]);
        mockResolvePendingPermission.mockResolvedValue(false);

        await expect(
          submitApprovalDecision(sessionContext, 'tool-1', 'allow_once')
        ).rejects.toThrow(RouteValidationError);
        await expect(
          submitApprovalDecision(sessionContext, 'tool-1', 'allow_once')
        ).rejects.toThrow('Tool call not found');
      });

      it('decodes URL-encoded tool call IDs', async () => {
        const mockSupervisor = {
          getWorkspaceSession: vi.fn().mockResolvedValue({ workspaceSessionId: 'ws_test-session' }),
        };
        mockGetSupervisor.mockResolvedValue(mockSupervisor as never);
        mockListPendingPermissions.mockResolvedValue([
          createMockPendingPermission({
            agentSessionId: 'as_agent1',
            toolCallId: 'tool/call+id',
          }),
        ]);
        mockResolvePendingPermission.mockResolvedValue(true);

        const result = await submitApprovalDecision(
          sessionContext,
          'tool%2Fcall%2Bid',
          'allow_once'
        );

        expect(mockResolvePendingPermission).toHaveBeenCalledWith({
          workspaceSessionId: 'ws_test-session',
          toolCallId: 'tool/call+id',
          decision: 'allow',
        });
        expect(result.toolCallId).toBe('tool/call+id');
      });
    });

    describe('thread scope', () => {
      const threadContext: ApprovalContext = {
        scope: 'thread',
        threadId: 'as_test-agent',
      };

      it('throws RouteValidationError when agent not found', async () => {
        const mockSupervisor = {
          listWorkspaceSessions: vi.fn().mockResolvedValue([]),
        };
        mockGetSupervisor.mockResolvedValue(mockSupervisor as never);

        await expect(submitApprovalDecision(threadContext, 'tool-1', 'allow_once')).rejects.toThrow(
          RouteValidationError
        );
        await expect(submitApprovalDecision(threadContext, 'tool-1', 'allow_once')).rejects.toThrow(
          'Agent not found'
        );
      });

      it('throws RouteValidationError when tool call not found for this agent', async () => {
        const mockSupervisor = {
          listWorkspaceSessions: vi.fn().mockResolvedValue([
            {
              workspaceSessionId: 'ws_test-session',
              agents: [{ sessionId: 'as_test-agent' }],
            },
          ]),
        };
        mockGetSupervisor.mockResolvedValue(mockSupervisor as never);
        mockListPendingPermissions.mockResolvedValue([
          createMockPendingPermission({
            agentSessionId: 'as_other-agent', // Different agent
            toolCallId: 'tool-1',
          }),
        ]);

        await expect(submitApprovalDecision(threadContext, 'tool-1', 'allow_once')).rejects.toThrow(
          RouteValidationError
        );
        await expect(submitApprovalDecision(threadContext, 'tool-1', 'allow_once')).rejects.toThrow(
          'Tool call not found'
        );
      });

      it('resolves pending permission for the correct agent', async () => {
        const mockSupervisor = {
          listWorkspaceSessions: vi.fn().mockResolvedValue([
            {
              workspaceSessionId: 'ws_test-session',
              agents: [{ sessionId: 'as_test-agent' }],
            },
          ]),
        };
        mockGetSupervisor.mockResolvedValue(mockSupervisor as never);
        mockListPendingPermissions.mockResolvedValue([
          createMockPendingPermission({
            agentSessionId: 'as_test-agent',
            toolCallId: 'tool-1',
          }),
        ]);
        mockResolvePendingPermission.mockResolvedValue(true);

        const result = await submitApprovalDecision(threadContext, 'tool-1', 'allow_once');

        expect(mockResolvePendingPermission).toHaveBeenCalledWith({
          workspaceSessionId: 'ws_test-session',
          toolCallId: 'tool-1',
          decision: 'allow',
        });
        expect(result).toEqual({ success: true, toolCallId: 'tool-1', decision: 'allow_once' });
      });
    });
  });
});
