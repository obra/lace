// ABOUTME: Unit tests for the ToolPolicyList component
// ABOUTME: Tests loading, error, empty, and normal states with tool policy interactions

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToolPolicyList } from './ToolPolicyList';
import type { ToolPolicy } from '@/components/ui/ToolPolicyToggle';

// Mock the ToolPolicyToggle component
vi.mock('@/components/ui/ToolPolicyToggle', () => ({
  ToolPolicyToggle: ({
    value,
    onChange,
    size,
  }: {
    value: ToolPolicy;
    onChange: (policy: ToolPolicy) => void;
    size: string;
  }) => (
    <select
      data-testid="tool-policy-toggle"
      value={value}
      onChange={(e) => onChange(e.target.value as ToolPolicy)}
      data-size={size}
    >
      <option value="allow">Allow</option>
      <option value="require-approval">Require Approval</option>
      <option value="deny">Deny</option>
    </select>
  ),
}));

describe('ToolPolicyList', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it('should show loading state', () => {
    render(<ToolPolicyList tools={[]} policies={{}} onChange={mockOnChange} loading={true} />);

    expect(screen.getByText('Loading tools...')).toBeInTheDocument();
    expect(screen.getByText('Loading tools...')).toBeVisible();
  });

  it('should show error state', () => {
    const errorMessage = 'Failed to fetch tools from server';

    render(
      <ToolPolicyList tools={[]} policies={{}} onChange={mockOnChange} error={errorMessage} />
    );

    expect(screen.getByText('Failed to load tools')).toBeInTheDocument();
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  it('should show empty state when no tools available', () => {
    render(<ToolPolicyList tools={[]} policies={{}} onChange={mockOnChange} />);

    expect(screen.getByText('No user-configurable tools available')).toBeInTheDocument();
  });

  it('should render tools with policies', () => {
    const tools = ['bash', 'file_read', 'file_write'];
    const policies = {
      bash: 'require-approval' as ToolPolicy,
      file_read: 'allow' as ToolPolicy,
    };

    render(<ToolPolicyList tools={tools} policies={policies} onChange={mockOnChange} />);

    // Check that all tools are rendered
    expect(screen.getByText('bash')).toBeInTheDocument();
    expect(screen.getByText('file_read')).toBeInTheDocument();
    expect(screen.getByText('file_write')).toBeInTheDocument();

    // Check policy toggles
    const toggles = screen.getAllByTestId('tool-policy-toggle');
    expect(toggles).toHaveLength(3);
  });

  it('should use default policy when none specified', () => {
    const tools = ['bash'];

    render(<ToolPolicyList tools={tools} policies={{}} onChange={mockOnChange} />);

    const toggle = screen.getByTestId('tool-policy-toggle');
    expect(toggle).toHaveValue('require-approval'); // default policy
  });

  it('should call onChange when policy is changed', () => {
    const tools = ['bash'];
    const policies = { bash: 'require-approval' as ToolPolicy };

    render(<ToolPolicyList tools={tools} policies={policies} onChange={mockOnChange} />);

    const toggle = screen.getByTestId('tool-policy-toggle');
    fireEvent.change(toggle, { target: { value: 'allow' } });

    expect(mockOnChange).toHaveBeenCalledWith('bash', 'allow');
  });

  it('should prioritize error over loading state', () => {
    render(
      <ToolPolicyList
        tools={[]}
        policies={{}}
        onChange={mockOnChange}
        loading={true}
        error="Network error"
      />
    );

    expect(screen.getByText('Failed to load tools')).toBeInTheDocument();
    expect(screen.queryByText('Loading tools...')).not.toBeInTheDocument();
  });

  it('should prioritize error over empty state', () => {
    render(<ToolPolicyList tools={[]} policies={{}} onChange={mockOnChange} error="API error" />);

    expect(screen.getByText('Failed to load tools')).toBeInTheDocument();
    expect(screen.queryByText('No user-configurable tools available')).not.toBeInTheDocument();
  });

  it('should pass size prop to ToolPolicyToggle', () => {
    render(<ToolPolicyList tools={['bash']} policies={{}} onChange={mockOnChange} />);

    const toggle = screen.getByTestId('tool-policy-toggle');
    expect(toggle).toHaveAttribute('data-size', 'sm');
  });
});
