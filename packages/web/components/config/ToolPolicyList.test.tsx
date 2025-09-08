// ABOUTME: Unit tests for the ToolPolicyList component with new policy structure
// ABOUTME: Tests loading, error, empty states and tool policy interactions using toolPolicyData

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToolPolicyList } from './ToolPolicyList';
import type { ToolPolicy } from '@/components/ui/ToolPolicyToggle';

// Tool policy info structure
interface ToolPolicyInfo {
  value: ToolPolicy;
  allowedValues: ToolPolicy[];
  projectValue?: ToolPolicy;
  globalValue?: ToolPolicy;
}

// Mock the ToolPolicyToggle component
vi.mock('@/components/ui/ToolPolicyToggle', () => ({
  ToolPolicyToggle: ({
    value,
    onChange,
    size,
    allowedValues,
  }: {
    value: ToolPolicy;
    onChange: (policy: ToolPolicy) => void;
    size: string;
    allowedValues?: ToolPolicy[];
  }) => (
    <select
      data-testid="tool-policy-toggle"
      value={value}
      onChange={(e) => onChange(e.target.value as ToolPolicy)}
      data-size={size}
      data-allowed={allowedValues?.join(',')}
    >
      {(allowedValues || ['allow', 'ask', 'deny']).map((policy) => (
        <option key={policy} value={policy}>
          {policy}
        </option>
      ))}
    </select>
  ),
}));

describe('ToolPolicyList', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it('should show loading state', () => {
    render(<ToolPolicyList toolPolicyData={{}} onChange={mockOnChange} loading={true} />);

    expect(screen.getByText('Loading tools...')).toBeInTheDocument();
    expect(screen.getByText('Loading tools...')).toBeVisible();
  });

  it('should show error state', () => {
    const errorMessage = 'Failed to fetch tools from server';
    render(<ToolPolicyList toolPolicyData={{}} onChange={mockOnChange} error={errorMessage} />);

    expect(screen.getByText('Failed to load tools')).toBeInTheDocument();
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  it('should show empty state when no tools available', () => {
    render(<ToolPolicyList toolPolicyData={{}} onChange={mockOnChange} />);

    expect(screen.getByText('No user-configurable tools available')).toBeInTheDocument();
  });

  it('should render core tools with policy information', () => {
    const toolPolicyData: Record<string, ToolPolicyInfo> = {
      bash: {
        value: 'ask',
        allowedValues: ['ask', 'deny', 'disable'],
        projectValue: 'allow',
      },
      file_read: {
        value: 'allow',
        allowedValues: ['allow', 'ask', 'deny', 'disable'],
      },
    };

    render(<ToolPolicyList toolPolicyData={toolPolicyData} onChange={mockOnChange} />);

    // Check that core tools section is rendered
    expect(screen.getByText('Core Tools')).toBeInTheDocument();

    // Check that all tools are rendered
    expect(screen.getByText('bash')).toBeInTheDocument();
    expect(screen.getByText('file_read')).toBeInTheDocument();

    // Check inheritance indicators
    expect(screen.getByText('Project: allow')).toBeInTheDocument();

    // Check that toggles have correct allowed values
    const toggles = screen.getAllByTestId('tool-policy-toggle');
    expect(toggles[0]).toHaveAttribute('data-allowed', 'ask,deny,disable');
    expect(toggles[1]).toHaveAttribute('data-allowed', 'allow,ask,deny,disable');
  });

  it('should render MCP tools grouped by server', () => {
    const toolPolicyData: Record<string, ToolPolicyInfo> = {
      'filesystem/read_file': {
        value: 'deny',
        allowedValues: ['deny', 'disable'],
        projectValue: 'deny',
      },
      'git/commit': {
        value: 'ask',
        allowedValues: ['allow', 'ask', 'deny', 'disable'],
      },
    };

    render(<ToolPolicyList toolPolicyData={toolPolicyData} onChange={mockOnChange} />);

    // Check MCP tool grouping
    expect(screen.getByText('filesystem MCP Tools')).toBeInTheDocument();
    expect(screen.getByText('git MCP Tools')).toBeInTheDocument();

    // Check tool names (without server prefix)
    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.getByText('commit')).toBeInTheDocument();

    // Check inheritance indicator
    expect(screen.getByText('Project: deny')).toBeInTheDocument();
  });

  it('should call onChange with correct tool name when policy changes', () => {
    const toolPolicyData: Record<string, ToolPolicyInfo> = {
      bash: {
        value: 'ask',
        allowedValues: ['allow', 'ask', 'deny', 'disable'],
      },
    };

    render(<ToolPolicyList toolPolicyData={toolPolicyData} onChange={mockOnChange} />);

    const toggle = screen.getByTestId('tool-policy-toggle');
    fireEvent.change(toggle, { target: { value: 'deny' } });

    expect(mockOnChange).toHaveBeenCalledWith('bash', 'deny');
  });

  it('should handle mixed loading and error state edge case', () => {
    render(
      <ToolPolicyList
        toolPolicyData={{}}
        onChange={mockOnChange}
        loading={true}
        error="Some error"
      />
    );

    // Error takes precedence over loading
    expect(screen.getByText('Failed to load tools')).toBeInTheDocument();
    expect(screen.queryByText('Loading tools...')).not.toBeInTheDocument();
  });

  it('should handle tools with no inheritance information', () => {
    const toolPolicyData: Record<string, ToolPolicyInfo> = {
      bash: {
        value: 'ask',
        allowedValues: ['allow', 'ask', 'deny', 'disable'],
        // No projectValue or globalValue
      },
    };

    render(<ToolPolicyList toolPolicyData={toolPolicyData} onChange={mockOnChange} />);

    expect(screen.getByText('bash')).toBeInTheDocument();
    // Should not show inheritance indicators when no parent values
    expect(screen.queryByText(/Project:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Global:/)).not.toBeInTheDocument();
  });
});
