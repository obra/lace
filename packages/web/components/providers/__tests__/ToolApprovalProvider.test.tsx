// ABOUTME: Integration tests for ToolApprovalProvider focusing on real provider responsibilities
// ABOUTME: Tests tool approval state management and API integration

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {
  ToolApprovalProvider,
  useToolApprovalContext,
} from '@/components/providers/ToolApprovalProvider';
import type { ThreadId } from '@/types/core';
import type { PendingApproval } from '@/types/api';
import type { ToolApprovalRequestData } from '@/types/web-events';

// Mock the serialization utility
vi.mock('@/lib/serialization', () => ({
  parseResponse: vi.fn(),
}));

vi.mock('@/types/api', () => ({
  isApiError: vi.fn(),
}));

import { parseResponse } from '@/lib/serialization';
import { isApiError } from '@/types/api';
const mockParseResponse = vi.mocked(parseResponse);
const mockIsApiError = vi.mocked(isApiError);

// Test data factories
const createMockApproval = (overrides?: Partial<PendingApproval>): PendingApproval => ({
  toolCallId: 'test-tool-call-id',
  toolCall: {
    name: 'test_tool',
    arguments: { param: 'value' },
  },
  requestedAt: new Date('2024-01-01'),
  requestData: {
    requestId: 'test-request-id',
    toolName: 'test_tool',
    input: { param: 'value' },
    isReadOnly: false,
    riskLevel: 'safe',
  } as ToolApprovalRequestData,
  ...overrides,
});

const mockApprovals: PendingApproval[] = [
  createMockApproval({
    toolCallId: 'approval-1',
    toolCall: { name: 'read_file', arguments: { path: '/test/file.txt' } },
    requestData: {
      requestId: 'req-1',
      toolName: 'read_file',
      input: { path: '/test/file.txt' },
      isReadOnly: true,
      riskLevel: 'safe',
    } as ToolApprovalRequestData,
  }),
  createMockApproval({
    toolCallId: 'approval-2',
    toolCall: { name: 'write_file', arguments: { path: '/test/output.txt', content: 'test' } },
    requestData: {
      requestId: 'req-2',
      toolName: 'write_file',
      input: { path: '/test/output.txt', content: 'test' },
      isReadOnly: false,
      riskLevel: 'moderate',
    } as ToolApprovalRequestData,
  }),
];

// Component to test context provision
function ContextConsumer() {
  const {
    pendingApprovals,
    loading,
    handleApprovalRequest,
    handleApprovalResponse,
    clearApprovalRequest,
    refreshPendingApprovals,
  } = useToolApprovalContext();

  return (
    <div>
      <div data-testid="approvals-count">{pendingApprovals.length}</div>
      <div data-testid="loading">{loading.toString()}</div>

      {pendingApprovals.map((approval, index) => (
        <div key={approval.toolCallId} data-testid={`approval-${index}`}>
          <span data-testid={`tool-name-${index}`}>{approval.toolCall.name}</span>
          <span data-testid={`tool-call-id-${index}`}>{approval.toolCallId}</span>
          <span data-testid={`risk-level-${index}`}>{approval.requestData.riskLevel}</span>
        </div>
      ))}

      <button
        onClick={() => handleApprovalRequest(createMockApproval())}
        data-testid="handle-approval-request"
      >
        Handle Approval Request
      </button>
      <button
        onClick={() => handleApprovalResponse('test-tool-call-id')}
        data-testid="handle-approval-response"
      >
        Handle Approval Response
      </button>
      <button onClick={() => clearApprovalRequest()} data-testid="clear-approvals">
        Clear Approvals
      </button>
      <button onClick={() => void refreshPendingApprovals()} data-testid="refresh-approvals">
        Refresh Approvals
      </button>
    </div>
  );
}

describe('ToolApprovalProvider', () => {
  const testAgentId = 'test-agent-id' as ThreadId;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn() as unknown as typeof global.fetch;
    mockParseResponse.mockResolvedValue([]);
    mockIsApiError.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Context Provision', () => {
    it('provides tool approval context to children', async () => {
      mockParseResponse.mockResolvedValue(mockApprovals);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('mock-response'),
        clone: function () {
          return this;
        },
      } as Response);

      render(
        <ToolApprovalProvider agentId={testAgentId}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByTestId('approvals-count')).toHaveTextContent('2');
      });

      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('tool-name-0')).toHaveTextContent('read_file');
      expect(screen.getByTestId('tool-name-1')).toHaveTextContent('write_file');
      expect(screen.getByTestId('risk-level-0')).toHaveTextContent('safe');
      expect(screen.getByTestId('risk-level-1')).toHaveTextContent('moderate');
    });

    it('throws error when used outside provider', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<ContextConsumer />);
      }).toThrow('useToolApprovalContext must be used within a ToolApprovalProvider');

      // Verify that React logged the error (error boundary behavior)
      expect(consoleSpy).toHaveBeenCalled();
      // Check that at least one call contains our error message
      const calls = consoleSpy.mock.calls.flat();
      expect(
        calls.some(
          (call) =>
            typeof call === 'string' &&
            call.includes('useToolApprovalContext must be used within a ToolApprovalProvider')
        )
      ).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  describe('Pending Approvals Management', () => {
    it('loads pending approvals on mount when agentId is provided', async () => {
      mockParseResponse.mockResolvedValue(mockApprovals);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('mock-response'),
        clone: function () {
          return this;
        },
      } as Response);

      render(
        <ToolApprovalProvider agentId={testAgentId}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(`/api/threads/${testAgentId}/approvals/pending`, {
          method: 'GET',
          signal: expect.any(AbortSignal),
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('approvals-count')).toHaveTextContent('2');
      });
    });

    it('clears approvals when agentId is null', async () => {
      mockParseResponse.mockResolvedValue(mockApprovals);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('mock-response'),
        clone: function () {
          return this;
        },
      } as Response);

      const { rerender } = render(
        <ToolApprovalProvider agentId={testAgentId}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      // Wait for initial load with approvals
      await waitFor(() => {
        expect(screen.getByTestId('approvals-count')).toHaveTextContent('2');
      });

      // Change to null agentId
      rerender(
        <ToolApprovalProvider agentId={null}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      // Should clear approvals and not be loading
      expect(screen.getByTestId('approvals-count')).toHaveTextContent('0');
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    it('handles empty approvals response', async () => {
      mockParseResponse.mockResolvedValue([]);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('[]'),
        clone: function () {
          return this;
        },
      } as Response);

      render(
        <ToolApprovalProvider agentId={testAgentId}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('approvals-count')).toHaveTextContent('0');
      });
    });

    it('handles null/undefined approvals response gracefully', async () => {
      mockParseResponse.mockResolvedValue(null);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('null'),
        clone: function () {
          return this;
        },
      } as Response);

      render(
        <ToolApprovalProvider agentId={testAgentId}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('approvals-count')).toHaveTextContent('0');
      });
    });
  });

  describe('Approval Actions', () => {
    it('handles approval requests by refreshing pending approvals', async () => {
      mockParseResponse.mockResolvedValue(mockApprovals);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('mock-response'),
        clone: function () {
          return this;
        },
      } as Response);

      render(
        <ToolApprovalProvider agentId={testAgentId}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByTestId('approvals-count')).toHaveTextContent('2');
      });

      // Clear previous calls
      vi.clearAllMocks();

      // Trigger approval request
      fireEvent.click(screen.getByTestId('handle-approval-request'));

      // Should trigger refresh
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(`/api/threads/${testAgentId}/approvals/pending`, {
          method: 'GET',
          signal: expect.any(AbortSignal),
        });
      });
    });

    it('handles approval responses by removing from pending list', async () => {
      mockParseResponse.mockResolvedValue(mockApprovals);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('mock-response'),
        clone: function () {
          return this;
        },
      } as Response);

      function TestApprovalResponse() {
        const { pendingApprovals, handleApprovalResponse } = useToolApprovalContext();
        return (
          <div>
            <div data-testid="approvals-count">{pendingApprovals.length}</div>
            <button
              onClick={() => handleApprovalResponse('approval-1')}
              data-testid="remove-first-approval"
            >
              Remove First
            </button>
            <button
              onClick={() => handleApprovalResponse('non-existent')}
              data-testid="remove-non-existent"
            >
              Remove Non-existent
            </button>
          </div>
        );
      }

      render(
        <ToolApprovalProvider agentId={testAgentId}>
          <TestApprovalResponse />
        </ToolApprovalProvider>
      );

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByTestId('approvals-count')).toHaveTextContent('2');
      });

      // Test removing non-existent approval (should have no effect)
      fireEvent.click(screen.getByTestId('remove-non-existent'));
      expect(screen.getByTestId('approvals-count')).toHaveTextContent('2');

      // Test removing actual approval
      fireEvent.click(screen.getByTestId('remove-first-approval'));
      expect(screen.getByTestId('approvals-count')).toHaveTextContent('1');
    });

    it('clears all approval requests', async () => {
      mockParseResponse.mockResolvedValue(mockApprovals);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('mock-response'),
        clone: function () {
          return this;
        },
      } as Response);

      render(
        <ToolApprovalProvider agentId={testAgentId}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByTestId('approvals-count')).toHaveTextContent('2');
      });

      // Clear all approvals
      fireEvent.click(screen.getByTestId('clear-approvals'));

      expect(screen.getByTestId('approvals-count')).toHaveTextContent('0');
    });

    it('refreshes pending approvals on demand', async () => {
      mockParseResponse.mockResolvedValue([]);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('[]'),
        clone: function () {
          return this;
        },
      } as Response);

      render(
        <ToolApprovalProvider agentId={testAgentId}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByTestId('approvals-count')).toHaveTextContent('0');
      });

      // Update mock to return approvals
      mockParseResponse.mockResolvedValue(mockApprovals);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('mock-with-approvals'),
        clone: function () {
          return this;
        },
      } as Response);

      // Trigger refresh
      fireEvent.click(screen.getByTestId('refresh-approvals'));

      await waitFor(() => {
        expect(screen.getByTestId('approvals-count')).toHaveTextContent('2');
      });
    });
  });

  describe('Loading States', () => {
    it('shows loading state during approval fetch', async () => {
      let resolvePromise: (value: Response) => void;
      const promise = new Promise<Response>((resolve) => {
        resolvePromise = resolve;
      });

      vi.mocked(global.fetch).mockReturnValue(promise);

      render(
        <ToolApprovalProvider agentId={testAgentId}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      // Should show loading initially
      expect(screen.getByTestId('loading')).toHaveTextContent('true');

      // Resolve the promise
      resolvePromise!({
        ok: true,
        text: () => Promise.resolve('[]'),
        clone: function () {
          return this;
        },
      } as Response);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });
    });

    it('handles fetch errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

      render(
        <ToolApprovalProvider agentId={testAgentId}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
        expect(screen.getByTestId('approvals-count')).toHaveTextContent('0');
      });

      // Check that error was logged
      expect(consoleSpy).toHaveBeenCalled();
      const calls = consoleSpy.mock.calls.flat();
      expect(
        calls.some(
          (call) =>
            typeof call === 'string' &&
            call.includes('[TOOL_APPROVAL] Failed to fetch pending approvals:')
        )
      ).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  describe('Error Handling', () => {
    it('handles HTTP errors by checking res.ok first', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Agent not found'),
        clone: function () {
          return this;
        },
      } as Response);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <ToolApprovalProvider agentId={testAgentId}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
        expect(screen.getByTestId('approvals-count')).toHaveTextContent('0');
      });

      // Critical: Should NOT call parseResponse on HTTP errors to avoid parsing HTML as JSON
      expect(mockParseResponse).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[TOOL_APPROVAL] Failed to fetch pending approvals:',
        expect.objectContaining({ message: 'HTTP 404: undefined' })
      );

      consoleSpy.mockRestore();
    });

    it('handles API errors after successful HTTP response', async () => {
      const errorResponse = { error: 'Agent not found' };
      mockParseResponse.mockResolvedValue(errorResponse);
      mockIsApiError.mockReturnValue(true);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"error": "Agent not found"}'),
        clone: function () {
          return this;
        },
      } as Response);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <ToolApprovalProvider agentId={testAgentId}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
        expect(screen.getByTestId('approvals-count')).toHaveTextContent('0');
      });

      // Should log the API error message from parsed response
      expect(consoleSpy).toHaveBeenCalledWith(
        '[TOOL_APPROVAL] Failed to fetch pending approvals:',
        expect.objectContaining({ message: 'Agent not found' })
      );

      consoleSpy.mockRestore();
    });

    it('handles HTTP errors without isApiError response', async () => {
      mockParseResponse.mockResolvedValue({ some: 'data' });
      mockIsApiError.mockReturnValue(false);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal server error'),
        clone: function () {
          return this;
        },
      } as Response);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <ToolApprovalProvider agentId={testAgentId}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
        expect(screen.getByTestId('approvals-count')).toHaveTextContent('0');
      });

      // Critical: Should NOT call parseResponse on HTTP errors to avoid parsing HTML as JSON
      expect(mockParseResponse).not.toHaveBeenCalled();
      // Should log the HTTP status error
      expect(consoleSpy).toHaveBeenCalledWith(
        '[TOOL_APPROVAL] Failed to fetch pending approvals:',
        expect.objectContaining({ message: 'HTTP 500: undefined' })
      );

      consoleSpy.mockRestore();
    });

    it('handles AbortError without logging', async () => {
      const abortError = new DOMException('Aborted', 'AbortError');
      vi.mocked(global.fetch).mockRejectedValue(abortError);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <ToolApprovalProvider agentId={testAgentId}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
        expect(screen.getByTestId('approvals-count')).toHaveTextContent('0');
      });

      // Should NOT log abort errors
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Agent ID Changes', () => {
    it('reloads approvals when agentId changes', async () => {
      mockParseResponse.mockResolvedValue(mockApprovals);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('mock-response'),
        clone: function () {
          return this;
        },
      } as Response);

      const { rerender } = render(
        <ToolApprovalProvider agentId={testAgentId}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      // Wait for initial load
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(`/api/threads/${testAgentId}/approvals/pending`, {
          method: 'GET',
          signal: expect.any(AbortSignal),
        });
      });

      vi.clearAllMocks();

      // Change agent ID
      const newAgentId = 'new-agent-id' as ThreadId;
      rerender(
        <ToolApprovalProvider agentId={newAgentId}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      // Should fetch for new agent
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(`/api/threads/${newAgentId}/approvals/pending`, {
          method: 'GET',
          signal: expect.any(AbortSignal),
        });
      });
    });
  });

  describe('Data Transformation', () => {
    it('transforms approvals data correctly', async () => {
      const rawApproval = createMockApproval({
        toolCallId: 'transform-test',
        toolCall: { name: 'test_transform', arguments: { key: 'value' } },
      });

      mockParseResponse.mockResolvedValue([rawApproval]);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('mock-response'),
        clone: function () {
          return this;
        },
      } as Response);

      render(
        <ToolApprovalProvider agentId={testAgentId}>
          <ContextConsumer />
        </ToolApprovalProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('approvals-count')).toHaveTextContent('1');
      });

      expect(screen.getByTestId('tool-name-0')).toHaveTextContent('test_transform');
      expect(screen.getByTestId('tool-call-id-0')).toHaveTextContent('transform-test');
    });
  });
});
