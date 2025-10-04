// ABOUTME: Test for session-scoped ToolApprovalProvider
// ABOUTME: Verifies that provider aggregates approvals from all agents in a session

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import {
  ToolApprovalProvider,
  useToolApprovalContext,
} from '@lace/web/components/providers/ToolApprovalProvider';
import { api } from '@lace/web/lib/api-client';
import type { ThreadId } from '@lace/web/types/core';
import { ApprovalDecision } from '@lace/web/types/core';
import type { SessionPendingApproval } from '@lace/web/types/api';

// Mock the api client
vi.mock('@lace/web/lib/api-client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const mockApi = vi.mocked(api);

// Test component to access the context
function TestComponent() {
  const { pendingApprovals, loading } = useToolApprovalContext();
  return (
    <div>
      <div data-testid="loading">{loading ? 'loading' : 'idle'}</div>
      <div data-testid="approvals-count">{pendingApprovals.length}</div>
      {pendingApprovals.map((approval, i) => (
        <div key={i} data-testid={`approval-${i}`}>
          {approval.toolCallId}-{approval.agentId}
        </div>
      ))}
    </div>
  );
}

describe('ToolApprovalProvider (Session-Scoped)', () => {
  const testSessionId = 'lace_20250916_test01' as ThreadId;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch session-wide approvals from correct API endpoint', async () => {
    const sessionApprovals = [
      {
        toolCallId: 'tool-call-1',
        toolCall: { name: 'file_write', arguments: {} },
        requestedAt: new Date('2023-01-01T10:00:00Z'),
        requestData: { toolName: 'file_write', riskLevel: 'destructive' as const },
        agentId: 'lace_20250916_test01.1',
      },
      {
        toolCallId: 'tool-call-2',
        toolCall: { name: 'file_read', arguments: {} },
        requestedAt: new Date('2023-01-01T10:01:00Z'),
        requestData: { toolName: 'file_read', riskLevel: 'safe' as const },
        agentId: 'lace_20250916_test01.2',
      },
    ];

    mockApi.get.mockResolvedValue(sessionApprovals);

    const { getByTestId } = render(
      <ToolApprovalProvider sessionId={testSessionId}>
        <TestComponent />
      </ToolApprovalProvider>
    );

    // Should call session-scoped endpoint
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(`/api/sessions/${testSessionId}/approvals/pending`, {
        signal: expect.any(AbortSignal),
      });
    });

    // Should show aggregated approvals from multiple agents
    await waitFor(() => {
      expect(getByTestId('approvals-count')).toHaveTextContent('2');
    });

    expect(getByTestId('approval-0')).toHaveTextContent('tool-call-1-lace_20250916_test01.1');
    expect(getByTestId('approval-1')).toHaveTextContent('tool-call-2-lace_20250916_test01.2');
  });

  it('should handle empty session gracefully', async () => {
    mockApi.get.mockResolvedValue([]);

    const { getByTestId } = render(
      <ToolApprovalProvider sessionId={testSessionId}>
        <TestComponent />
      </ToolApprovalProvider>
    );

    await waitFor(() => {
      expect(getByTestId('approvals-count')).toHaveTextContent('0');
    });
  });

  it('should handle API errors gracefully', async () => {
    mockApi.get.mockRejectedValue(new Error('Session not found'));

    const { getByTestId } = render(
      <ToolApprovalProvider sessionId={testSessionId}>
        <TestComponent />
      </ToolApprovalProvider>
    );

    // Should still render with empty approvals
    await waitFor(() => {
      expect(getByTestId('approvals-count')).toHaveTextContent('0');
      expect(getByTestId('loading')).toHaveTextContent('idle');
    });
  });

  it('should make approval decisions to session-scoped endpoint', async () => {
    const sessionApprovals = [
      {
        toolCallId: 'tool-call-1',
        toolCall: { name: 'file_write', arguments: {} },
        requestedAt: new Date('2023-01-01T10:00:00Z'),
        requestData: { toolName: 'file_write', riskLevel: 'destructive' as const },
        agentId: 'lace_20250916_test01.1',
      },
    ];

    mockApi.get.mockResolvedValue(sessionApprovals);
    mockApi.post.mockResolvedValue({});

    function TestDecisionComponent() {
      const { handleApprovalDecision } = useToolApprovalContext();
      return (
        <button
          onClick={() => handleApprovalDecision('tool-call-1', ApprovalDecision.ALLOW_ONCE)}
          data-testid="approve-button"
        >
          Approve
        </button>
      );
    }

    const { getByTestId } = render(
      <ToolApprovalProvider sessionId={testSessionId}>
        <TestDecisionComponent />
      </ToolApprovalProvider>
    );

    await waitFor(() => {
      expect(getByTestId('approve-button')).toBeInTheDocument();
    });

    // Click approve button
    getByTestId('approve-button').click();

    // Should call session-scoped approval endpoint (need to route to correct agent)
    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        `/api/sessions/${testSessionId}/approvals/tool-call-1`,
        { decision: ApprovalDecision.ALLOW_ONCE }
      );
    });
  });
});
