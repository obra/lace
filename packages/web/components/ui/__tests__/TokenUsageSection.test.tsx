// ABOUTME: Unit tests for TokenUsageSection component
// ABOUTME: Tests loading, error, success, and no-data states

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TokenUsageSection } from '@/components/ui/TokenUsageSection';
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
      Tokens: {tokenUsage?.inputTokens || 0} + {tokenUsage?.outputTokens || 0}
    </div>
  ),
}));

describe('TokenUsageSection', () => {
  const testAgentId = 'test-agent-123' as ThreadId;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state when data is being fetched', () => {
    mockUseAgentTokenUsage.mockReturnValue({
      loading: true,
      error: null,
      tokenUsage: null,
    });

    render(<TokenUsageSection agentId={testAgentId} />);

    expect(screen.getByText('Loading usage data...')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument(); // loading spinner
  });

  it('shows error state when there is an error', () => {
    mockUseAgentTokenUsage.mockReturnValue({
      loading: false,
      error: new Error('Failed to fetch'),
      tokenUsage: null,
    });

    render(<TokenUsageSection agentId={testAgentId} />);

    expect(screen.getByText('⚠️')).toBeInTheDocument();
    expect(screen.getByText('Could not load usage data')).toBeInTheDocument();
  });

  it('shows no data state when tokenUsage is null', () => {
    mockUseAgentTokenUsage.mockReturnValue({
      loading: false,
      error: null,
      tokenUsage: null,
    });

    render(<TokenUsageSection agentId={testAgentId} />);

    expect(screen.getByText('📊')).toBeInTheDocument();
    expect(screen.getByText('No usage data yet')).toBeInTheDocument();
  });

  it('renders TokenUsageDisplay when data is available', () => {
    const mockTokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
    };

    mockUseAgentTokenUsage.mockReturnValue({
      loading: false,
      error: null,
      tokenUsage: mockTokenUsage,
    });

    render(<TokenUsageSection agentId={testAgentId} />);

    expect(screen.getByTestId('token-usage-display')).toBeInTheDocument();
    expect(screen.getByText('Tokens: 100 + 50')).toBeInTheDocument();
  });

  it('calls useAgentTokenUsage with the correct agentId', () => {
    mockUseAgentTokenUsage.mockReturnValue({
      loading: false,
      error: null,
      tokenUsage: { inputTokens: 10, outputTokens: 5 },
    });

    render(<TokenUsageSection agentId={testAgentId} />);

    expect(mockUseAgentTokenUsage).toHaveBeenCalledWith(testAgentId);
  });

  it('has consistent styling across all states', () => {
    const baseClasses =
      'flex justify-center p-2 border-t border-base-300/50 bg-base-100/50 backdrop-blur-sm';

    // Test loading state
    mockUseAgentTokenUsage.mockReturnValue({ loading: true, error: null, tokenUsage: null });
    const { rerender, unmount } = render(<TokenUsageSection agentId={testAgentId} />);
    expect(screen.getByText('Loading usage data...').closest('div')?.parentElement).toHaveClass(
      baseClasses
    );

    // Test error state
    unmount();
    vi.clearAllMocks();
    mockUseAgentTokenUsage.mockReturnValue({
      loading: false,
      error: new Error('test'),
      tokenUsage: null,
    });
    const { rerender: rerender2, unmount: unmount2 } = render(
      <TokenUsageSection agentId={testAgentId} />
    );
    expect(screen.getByText('Could not load usage data').closest('div')?.parentElement).toHaveClass(
      baseClasses
    );

    // Test no data state
    unmount2();
    vi.clearAllMocks();
    mockUseAgentTokenUsage.mockReturnValue({ loading: false, error: null, tokenUsage: null });
    const { rerender: rerender3, unmount: unmount3 } = render(
      <TokenUsageSection agentId={testAgentId} />
    );
    expect(screen.getByText('No usage data yet').closest('div')?.parentElement).toHaveClass(
      baseClasses
    );

    // Test success state
    unmount3();
    vi.clearAllMocks();
    mockUseAgentTokenUsage.mockReturnValue({
      loading: false,
      error: null,
      tokenUsage: { inputTokens: 10, outputTokens: 5 },
    });
    render(<TokenUsageSection agentId={testAgentId} />);
    expect(screen.getByTestId('token-usage-display').parentElement).toHaveClass(baseClasses);
  });
});
