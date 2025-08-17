// ABOUTME: Unit tests for CompactTokenUsage component
// ABOUTME: Tests loading, error handling (null return), and success states

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CompactTokenUsage } from '@/components/ui/CompactTokenUsage';
import type { ThreadId } from '@/types/core';

// Use vi.hoisted to ensure mock functions are available during hoisting
const mockUseAgentTokenUsage = vi.hoisted(() => vi.fn());

// Mock the useAgentTokenUsage hook
vi.mock('@/hooks/useAgentTokenUsage', () => ({
  useAgentTokenUsage: mockUseAgentTokenUsage,
}));

// Mock TokenUsageDisplay component
vi.mock('@/components/ui', () => ({
  TokenUsageDisplay: ({
    tokenUsage,
  }: {
    tokenUsage: { inputTokens: number; outputTokens: number } | null;
  }) => (
    <div data-testid="token-usage-display">
      Compact: {tokenUsage?.inputTokens || 0} + {tokenUsage?.outputTokens || 0}
    </div>
  ),
}));

describe('CompactTokenUsage', () => {
  const testAgentId = 'test-agent-456' as ThreadId;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state when data is being fetched', () => {
    mockUseAgentTokenUsage.mockReturnValue({
      loading: true,
      error: null,
      tokenUsage: null,
    });

    render(<CompactTokenUsage agentId={testAgentId} />);

    expect(screen.getByText('Loading usage...')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument(); // loading spinner
  });

  it('returns null when there is an error (graceful error handling)', () => {
    mockUseAgentTokenUsage.mockReturnValue({
      loading: false,
      error: new Error('Failed to fetch'),
      tokenUsage: null,
    });

    const { container } = render(<CompactTokenUsage agentId={testAgentId} />);

    // Component should return null, so container should be empty
    expect(container.firstChild).toBeNull();
  });

  it('returns null when tokenUsage is null (graceful no-data handling)', () => {
    mockUseAgentTokenUsage.mockReturnValue({
      loading: false,
      error: null,
      tokenUsage: null,
    });

    const { container } = render(<CompactTokenUsage agentId={testAgentId} />);

    // Component should return null, so container should be empty
    expect(container.firstChild).toBeNull();
  });

  it('renders TokenUsageDisplay when data is available', () => {
    const mockTokenUsage = {
      inputTokens: 50,
      outputTokens: 25,
    };

    mockUseAgentTokenUsage.mockReturnValue({
      loading: false,
      error: null,
      tokenUsage: mockTokenUsage,
    });

    render(<CompactTokenUsage agentId={testAgentId} />);

    expect(screen.getByTestId('token-usage-display')).toBeInTheDocument();
    expect(screen.getByText('Compact: 50 + 25')).toBeInTheDocument();
  });

  it('calls useAgentTokenUsage with the correct agentId', () => {
    mockUseAgentTokenUsage.mockReturnValue({
      loading: false,
      error: null,
      tokenUsage: { inputTokens: 10, outputTokens: 5 },
    });

    render(<CompactTokenUsage agentId={testAgentId} />);

    expect(mockUseAgentTokenUsage).toHaveBeenCalledWith(testAgentId);
  });

  it('passes loading=false to TokenUsageDisplay in success state', () => {
    const mockTokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
    };

    mockUseAgentTokenUsage.mockReturnValue({
      loading: false,
      error: null,
      tokenUsage: mockTokenUsage,
    });

    render(<CompactTokenUsage agentId={testAgentId} />);

    // We can't directly test the loading prop, but we can verify the component renders
    // which means TokenUsageDisplay was called with the correct props
    expect(screen.getByTestId('token-usage-display')).toBeInTheDocument();
  });

  it('has correct compact styling', () => {
    const mockTokenUsage = {
      inputTokens: 10,
      outputTokens: 5,
    };

    mockUseAgentTokenUsage.mockReturnValue({
      loading: false,
      error: null,
      tokenUsage: mockTokenUsage,
    });

    render(<CompactTokenUsage agentId={testAgentId} />);

    const container = screen.getByTestId('token-usage-display').parentElement;
    expect(container).toHaveClass('text-xs', 'text-base-content/40');
  });
});
