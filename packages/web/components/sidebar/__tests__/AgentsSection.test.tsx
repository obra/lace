// ABOUTME: Unit tests for AgentsSection component
// ABOUTME: Tests agent listing, selection, and add agent button functionality

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AgentsSection } from '../AgentsSection';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { useOptionalTaskContext } from '@/components/providers/TaskProvider';

// Mock the context hooks
vi.mock('@/components/providers/AgentProvider');
vi.mock('@/components/providers/TaskProvider');

const mockUseAgentContext = vi.mocked(useAgentContext);
const mockUseOptionalTaskContext = vi.mocked(useOptionalTaskContext);

const mockSessionDetails = {
  sessionId: 'session-1',
  agents: [
    {
      threadId: 'agent-1',
      name: 'Test Agent',
      status: 'idle' as const,
    },
  ],
};

describe('AgentsSection', () => {
  beforeEach(() => {
    mockUseAgentContext.mockReturnValue({
      sessionDetails: mockSessionDetails,
      selectedAgent: null,
    });
    mockUseOptionalTaskContext.mockReturnValue({
      taskManager: { tasks: [] },
    });
  });

  it('should render agents section with title and icon', () => {
    render(<AgentsSection onAgentSelect={vi.fn()} />);

    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Test Agent')).toBeInTheDocument();
  });

  it('should not render add agent button when onCreateAgent not provided', () => {
    render(<AgentsSection onAgentSelect={vi.fn()} />);

    expect(screen.queryByTestId('add-agent-button')).not.toBeInTheDocument();
  });

  it('should render add agent button when onCreateAgent provided', () => {
    const mockOnCreateAgent = vi.fn();
    render(<AgentsSection onAgentSelect={vi.fn()} onCreateAgent={mockOnCreateAgent} />);

    const addButton = screen.getByTestId('add-agent-button');
    expect(addButton).toBeInTheDocument();
  });

  it('should call onCreateAgent when add button clicked', () => {
    const mockOnCreateAgent = vi.fn();
    render(<AgentsSection onAgentSelect={vi.fn()} onCreateAgent={mockOnCreateAgent} />);

    const addButton = screen.getByTestId('add-agent-button');
    fireEvent.click(addButton);

    expect(mockOnCreateAgent).toHaveBeenCalledOnce();
  });

  it('should call onAgentSelect when agent clicked', () => {
    const mockOnAgentSelect = vi.fn();
    render(<AgentsSection onAgentSelect={mockOnAgentSelect} />);

    const agentItem = screen.getByText('Test Agent');
    fireEvent.click(agentItem);

    expect(mockOnAgentSelect).toHaveBeenCalledWith('agent-1');
  });

  it('should return null when no session details', () => {
    mockUseAgentContext.mockReturnValue({
      sessionDetails: null,
      selectedAgent: null,
    });

    const { container } = render(<AgentsSection onAgentSelect={vi.fn()} />);

    expect(container.firstChild).toBeNull();
  });

  it('should return null when no agents in session', () => {
    mockUseAgentContext.mockReturnValue({
      sessionDetails: { ...mockSessionDetails, agents: [] },
      selectedAgent: null,
    });

    const { container } = render(<AgentsSection onAgentSelect={vi.fn()} />);

    expect(container.firstChild).toBeNull();
  });
});
