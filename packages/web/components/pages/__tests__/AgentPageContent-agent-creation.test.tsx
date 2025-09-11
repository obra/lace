// ABOUTME: Integration tests for AgentPageContent agent creation modal
// ABOUTME: Tests modal state management and agent creation workflow

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AgentPageContent } from '../AgentPageContent';

// Mock all complex dependencies and context providers
vi.mock('@/hooks/useURLState', () => ({
  useURLState: () => ({
    navigateToAgent: vi.fn(),
    navigateToRoot: vi.fn(),
  }),
}));

vi.mock('@/components/providers/UIProvider', () => ({
  useUIContext: () => ({
    sidebarOpen: true,
    toggleSidebar: vi.fn(),
  }),
}));

vi.mock('@/components/providers/ProjectProvider', () => ({
  useProjectContext: () => ({
    currentProject: { id: 'project-1', name: 'Test Project' },
  }),
}));

vi.mock('@/components/providers/AgentProvider', () => ({
  useAgentContext: () => ({
    sessionDetails: {
      id: 'session-1',
      agents: [{ threadId: 'agent-1', name: 'Test Agent', status: 'idle' }],
    },
    loadAgentConfiguration: vi.fn(),
    updateAgent: vi.fn(),
    reloadSessionDetails: vi.fn(),
  }),
}));

vi.mock('@/components/providers/ToolApprovalProvider', () => ({
  useToolApprovalContext: () => ({
    pendingApprovals: [],
    handleApprovalDecision: vi.fn(),
  }),
}));

vi.mock('@/components/providers/ProviderInstanceProvider', () => ({
  useProviderInstances: () => ({
    availableProviders: [
      {
        instanceId: 'anthropic-1',
        displayName: 'Anthropic',
        configured: true,
        models: [{ id: 'claude-3', displayName: 'Claude 3' }],
      },
    ],
  }),
}));

vi.mock('@/components/providers/EventStreamProvider', () => ({
  useEventStreamContext: () => ({
    agentEvents: { events: [] },
  }),
}));

// Mock the complex layout components
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

vi.mock('@/components/layout/Sidebar', () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar">{children}</div>
  ),
}));

vi.mock('@/components/chat/Chat', () => ({
  Chat: () => <div data-testid="chat">Chat Component</div>,
}));

vi.mock('@/components/modals/ToolApprovalModal', () => ({
  ToolApprovalModal: () => <div data-testid="tool-approval-modal">Tool Approval Modal</div>,
}));

vi.mock('@/components/settings/SettingsContainer', () => ({
  SettingsContainer: ({ children }: { children: (props: any) => React.ReactNode }) =>
    children({ onOpenSettings: vi.fn() }),
}));

vi.mock('@/components/config/SessionEditModal', () => ({
  SessionEditModal: () => <div data-testid="session-edit-modal">Session Edit Modal</div>,
}));

// Mock SidebarContent to test the onCreateAgent integration
vi.mock('@/components/sidebar/SidebarContent', () => ({
  SidebarContent: ({ onCreateAgent }: { onCreateAgent?: () => void }) => (
    <div data-testid="sidebar-content">
      <button
        data-testid="mock-create-agent-button"
        onClick={onCreateAgent}
        disabled={!onCreateAgent}
      >
        Create Agent
      </button>
    </div>
  ),
}));

// Mock the AgentCreateChatModal
vi.mock('@/components/modals/AgentCreateChatModal', () => ({
  AgentCreateChatModal: ({
    isOpen,
    onClose,
    onCreateAgent,
    defaultPersonaName,
    defaultProviderInstanceId,
    defaultModelId,
  }: any) =>
    isOpen ? (
      <div data-testid="agent-create-modal">
        <div data-testid="modal-defaults">
          {defaultPersonaName}-{defaultProviderInstanceId}-{defaultModelId}
        </div>
        <button
          data-testid="modal-create-button"
          onClick={() =>
            onCreateAgent({
              personaName: 'test-persona',
              providerInstanceId: 'anthropic-1',
              modelId: 'claude-3',
              initialMessage: 'Hello!',
            })
          }
        >
          Create Agent
        </button>
        <button data-testid="modal-close-button" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null,
}));

describe('AgentPageContent Agent Creation Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render create agent button in sidebar', () => {
    render(<AgentPageContent projectId="project-1" sessionId="session-1" agentId="agent-1" />);

    expect(screen.getByTestId('mock-create-agent-button')).toBeInTheDocument();
    expect(screen.getByTestId('mock-create-agent-button')).not.toBeDisabled();
  });

  it('should show modal when create agent button clicked', () => {
    render(<AgentPageContent projectId="project-1" sessionId="session-1" agentId="agent-1" />);

    // Initially modal should not be visible
    expect(screen.queryByTestId('agent-create-modal')).not.toBeInTheDocument();

    // Click create agent button
    fireEvent.click(screen.getByTestId('mock-create-agent-button'));

    // Modal should now be visible
    expect(screen.getByTestId('agent-create-modal')).toBeInTheDocument();
  });

  it('should close modal when close button clicked', () => {
    render(<AgentPageContent projectId="project-1" sessionId="session-1" agentId="agent-1" />);

    // Open modal
    fireEvent.click(screen.getByTestId('mock-create-agent-button'));
    expect(screen.getByTestId('agent-create-modal')).toBeInTheDocument();

    // Close modal
    fireEvent.click(screen.getByTestId('modal-close-button'));
    expect(screen.queryByTestId('agent-create-modal')).not.toBeInTheDocument();
  });

  it('should pass smart defaults to modal', () => {
    render(<AgentPageContent projectId="project-1" sessionId="session-1" agentId="agent-1" />);

    // Open modal
    fireEvent.click(screen.getByTestId('mock-create-agent-button'));

    // Should show defaults (default persona + current provider/model)
    const defaults = screen.getByTestId('modal-defaults');
    expect(defaults).toHaveTextContent('default-anthropic-1-claude-3');
  });

  it('should handle agent creation from modal', async () => {
    // Mock the agent creation API call
    const mockApiPost = vi.fn().mockResolvedValue({});
    vi.doMock('@/lib/api-client', () => ({
      api: { post: mockApiPost },
    }));

    render(<AgentPageContent projectId="project-1" sessionId="session-1" agentId="agent-1" />);

    // Open modal and create agent
    fireEvent.click(screen.getByTestId('mock-create-agent-button'));
    fireEvent.click(screen.getByTestId('modal-create-button'));

    // Should call agent creation API
    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/sessions/session-1/agents', {
        name: 'test-persona Agent',
        providerInstanceId: 'anthropic-1',
        modelId: 'claude-3',
        persona: 'test-persona',
        initialMessage: 'Hello!',
      });
    });
  });

  it('should close modal after successful agent creation', async () => {
    render(<AgentPageContent projectId="project-1" sessionId="session-1" agentId="agent-1" />);

    // Open modal
    fireEvent.click(screen.getByTestId('mock-create-agent-button'));
    expect(screen.getByTestId('agent-create-modal')).toBeInTheDocument();

    // Create agent
    fireEvent.click(screen.getByTestId('modal-create-button'));

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByTestId('agent-create-modal')).not.toBeInTheDocument();
    });
  });
});
