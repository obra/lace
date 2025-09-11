// ABOUTME: Integration tests for SidebarContent agent creation functionality
// ABOUTME: Tests modal integration and agent creation flow

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SidebarContent } from '../SidebarContent';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useOptionalAgentContext } from '@/components/providers/AgentProvider';

// Mock all the context providers
vi.mock('@/components/providers/ProjectProvider');
vi.mock('@/components/providers/AgentProvider');

// Mock AgentsSection with the onCreateAgent prop
vi.mock('../AgentsSection', () => ({
  AgentsSection: ({ onCreateAgent }: { onCreateAgent?: () => void }) => (
    <div data-testid="agents-section">
      {onCreateAgent && (
        <button data-testid="add-agent-button" onClick={onCreateAgent}>
          Add Agent
        </button>
      )}
    </div>
  ),
}));

// Mock the child components that need complex setup
vi.mock('@/components/sidebar/ProjectSection', () => ({
  ProjectSection: ({ onSwitchProject }: { onSwitchProject: () => void }) => (
    <div data-testid="project-section">
      <button onClick={onSwitchProject}>Switch Project</button>
    </div>
  ),
}));

vi.mock('@/components/sidebar/SessionSection', () => ({
  SessionSection: () => <div data-testid="session-section">Session Section</div>,
}));

vi.mock('@/components/sidebar/TaskSidebarSection', () => ({
  TaskSidebarSection: () => <div data-testid="task-section">Task Section</div>,
}));

vi.mock('@/components/sidebar/FeedbackSection', () => ({
  FeedbackSection: () => <div data-testid="feedback-section">Feedback Section</div>,
}));

vi.mock('@/components/sidebar/FileBrowserSection', () => ({
  FileBrowserSection: () => <div data-testid="file-browser-section">File Browser Section</div>,
}));

const mockUseProjectContext = vi.mocked(useProjectContext);
const mockUseOptionalAgentContext = vi.mocked(useOptionalAgentContext);

const mockSessionDetails = {
  id: 'session-1',
  agents: [
    {
      threadId: 'agent-1',
      name: 'Test Agent',
      status: 'idle' as const,
    },
  ],
};

describe('SidebarContent Agent Creation Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseProjectContext.mockReturnValue({
      selectedProject: { id: 'project-1', name: 'Test Project' },
    });

    mockUseOptionalAgentContext.mockReturnValue({
      sessionDetails: mockSessionDetails,
      selectedAgent: null,
    });
  });

  it('should pass onCreateAgent prop to AgentsSection when provided', () => {
    const mockOnCreateAgent = vi.fn();

    render(
      <SidebarContent
        onSwitchProject={vi.fn()}
        onAgentSelect={vi.fn()}
        onCreateAgent={mockOnCreateAgent}
      />
    );

    expect(screen.getByTestId('add-agent-button')).toBeInTheDocument();
  });

  it('should not show add agent button when onCreateAgent not provided', () => {
    render(<SidebarContent onSwitchProject={vi.fn()} onAgentSelect={vi.fn()} />);

    expect(screen.queryByTestId('add-agent-button')).not.toBeInTheDocument();
  });

  it('should call onCreateAgent when add agent button clicked', () => {
    const mockOnCreateAgent = vi.fn();

    render(
      <SidebarContent
        onSwitchProject={vi.fn()}
        onAgentSelect={vi.fn()}
        onCreateAgent={mockOnCreateAgent}
      />
    );

    const addButton = screen.getByTestId('add-agent-button');
    fireEvent.click(addButton);

    expect(mockOnCreateAgent).toHaveBeenCalledOnce();
  });

  it('should not render AgentsSection when no session details', () => {
    mockUseOptionalAgentContext.mockReturnValue({
      sessionDetails: null,
      selectedAgent: null,
    });

    const { container } = render(
      <SidebarContent onSwitchProject={vi.fn()} onAgentSelect={vi.fn()} onCreateAgent={vi.fn()} />
    );

    // AgentsSection should not be rendered
    expect(container.innerHTML).not.toContain('add-agent-button');
  });
});
