// ABOUTME: Tests for context breakdown modal
// ABOUTME: Validates modal behavior, loading states, and data display

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ContextBreakdownModal } from './ContextBreakdownModal';
import { api } from '@/lib/api-client';
import type { ContextBreakdown } from '@/types/context';

// Mock ResizeObserver for Recharts
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
  },
}));

describe('ContextBreakdownModal', () => {
  const mockAgentId = 'test-agent-123';
  const mockOnClose = vi.fn();

  const mockBreakdown: ContextBreakdown = {
    timestamp: '2025-09-29T14:23:45.123Z',
    modelId: 'claude-sonnet-4-5',
    contextLimit: 200000,
    totalUsedTokens: 95430,
    percentUsed: 0.477,
    categories: {
      systemPrompt: { tokens: 8450 },
      coreTools: { tokens: 12300, items: [{ name: 'file_read', tokens: 2100 }] },
      mcpTools: { tokens: 0, items: [] },
      messages: {
        tokens: 45780,
        subcategories: {
          userMessages: { tokens: 8900 },
          agentMessages: { tokens: 28300 },
          toolCalls: { tokens: 3200 },
          toolResults: { tokens: 5380 },
        },
      },
      reservedForResponse: { tokens: 20000 },
      freeSpace: { tokens: 24700 },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render when closed', () => {
    render(<ContextBreakdownModal isOpen={false} onClose={mockOnClose} agentId={mockAgentId} />);

    expect(screen.queryByText('Context Usage')).not.toBeInTheDocument();
  });

  it('should show loading state', () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));

    render(<ContextBreakdownModal isOpen={true} onClose={mockOnClose} agentId={mockAgentId} />);

    expect(screen.getByText('Context Usage')).toBeInTheDocument();
    // Modal should be visible during loading
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should display breakdown data', async () => {
    vi.mocked(api.get).mockResolvedValue(mockBreakdown);

    render(<ContextBreakdownModal isOpen={true} onClose={mockOnClose} agentId={mockAgentId} />);

    await waitFor(() => {
      expect(screen.getByText('System Prompt')).toBeInTheDocument();
    });

    expect(screen.getByText('Core Tools')).toBeInTheDocument();
    expect(screen.getByText('Messages')).toBeInTheDocument();
    expect(screen.getByText('Reserved for Response')).toBeInTheDocument();
    expect(screen.getAllByText('Free Space').length).toBeGreaterThan(0);
  });

  it('should display error message on fetch failure', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));

    render(<ContextBreakdownModal isOpen={true} onClose={mockOnClose} agentId={mockAgentId} />);

    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeInTheDocument();
    });
  });

  it('should display summary stats', async () => {
    vi.mocked(api.get).mockResolvedValue(mockBreakdown);

    render(<ContextBreakdownModal isOpen={true} onClose={mockOnClose} agentId={mockAgentId} />);

    await waitFor(() => {
      expect(screen.getByText('Context Window')).toBeInTheDocument();
    });

    expect(screen.getByText('200,000')).toBeInTheDocument(); // contextLimit
    expect(screen.getByText('Used Tokens')).toBeInTheDocument();
    expect(screen.getByText('95,430')).toBeInTheDocument(); // totalUsedTokens
  });

  it('should display message subcategories', async () => {
    vi.mocked(api.get).mockResolvedValue(mockBreakdown);

    render(<ContextBreakdownModal isOpen={true} onClose={mockOnClose} agentId={mockAgentId} />);

    await waitFor(() => {
      expect(screen.getByText('Messages')).toBeInTheDocument();
    });

    expect(screen.getByText('User Messages:')).toBeInTheDocument();
    expect(screen.getByText('Agent Messages:')).toBeInTheDocument();
    expect(screen.getByText('Tool Calls:')).toBeInTheDocument();
    expect(screen.getByText('Tool Results:')).toBeInTheDocument();
  });

  it('should fetch breakdown when modal opens', async () => {
    vi.mocked(api.get).mockResolvedValue(mockBreakdown);

    const { rerender } = render(
      <ContextBreakdownModal isOpen={false} onClose={mockOnClose} agentId={mockAgentId} />
    );

    expect(api.get).not.toHaveBeenCalled();

    rerender(<ContextBreakdownModal isOpen={true} onClose={mockOnClose} agentId={mockAgentId} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(`/api/agents/${mockAgentId}/context`);
    });
  });

  it('should handle MCP tools when present', async () => {
    const breakdownWithMCP: ContextBreakdown = {
      ...mockBreakdown,
      categories: {
        ...mockBreakdown.categories,
        mcpTools: { tokens: 5600, items: [{ name: 'filesystem/list', tokens: 5600 }] },
      },
    };

    vi.mocked(api.get).mockResolvedValue(breakdownWithMCP);

    render(<ContextBreakdownModal isOpen={true} onClose={mockOnClose} agentId={mockAgentId} />);

    await waitFor(() => {
      expect(screen.getByText('MCP Tools')).toBeInTheDocument();
    });

    expect(screen.getByText('5,600 tokens')).toBeInTheDocument();
  });

  it('should display model information', async () => {
    vi.mocked(api.get).mockResolvedValue(mockBreakdown);

    render(<ContextBreakdownModal isOpen={true} onClose={mockOnClose} agentId={mockAgentId} />);

    await waitFor(() => {
      expect(screen.getByText(/claude-sonnet-4-5/)).toBeInTheDocument();
    });
  });
});
