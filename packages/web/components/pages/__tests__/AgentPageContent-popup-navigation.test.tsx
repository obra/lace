// ABOUTME: Integration tests for AgentPageContent with chat popup and navigation
// ABOUTME: Tests popup integration, agent creation, and navigation to new agent

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AgentPageContent } from '../AgentPageContent';

// Get the mocked api
const { mockApiPost } = (await vi.importMock('@/lib/api-client')) as {
  mockApiPost: ReturnType<typeof vi.fn>;
};

// Mock all dependencies
const mockNavigateToAgent = vi.fn();

vi.mock('@/hooks/useURLState', () => ({
  useURLState: () => ({
    navigateToAgent: mockNavigateToAgent,
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

// Mock api client to simulate agent creation
vi.mock('@/lib/api-client', () => {
  const mockApiPost = vi.fn();
  return {
    api: {
      get: vi.fn().mockResolvedValue({ personas: [] }),
      post: mockApiPost,
    },
    mockApiPost, // Export for test access
  };
});

// Mock layout components to focus on integration
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
  ToolApprovalModal: () => null,
}));

vi.mock('@/components/settings/SettingsContainer', () => ({
  SettingsContainer: ({ children }: { children: (props: any) => React.ReactNode }) =>
    children({ onOpenSettings: vi.fn() }),
}));

vi.mock('@/components/config/SessionEditModal', () => ({
  SessionEditModal: () => null,
}));

// Mock SidebarContent to provide the + button
vi.mock('@/components/sidebar/SidebarContent', () => ({
  SidebarContent: ({ onCreateAgent }: { onCreateAgent?: () => void }) => {
    const buttonRef = React.useRef<HTMLButtonElement>(null);

    return (
      <div data-testid="sidebar-content">
        <button ref={buttonRef} data-testid="create-agent-button" onClick={onCreateAgent}>
          Create Agent
        </button>
      </div>
    );
  },
}));

describe('AgentPageContent - Popup Integration and Navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use AgentCreateChatPopup instead of modal', () => {
    render(<AgentPageContent projectId="project-1" sessionId="session-1" agentId="agent-1" />);

    fireEvent.click(screen.getByTestId('create-agent-button'));

    // Should show popup, not modal
    expect(screen.getByTestId('agent-create-popup')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should not show model selector in popup', () => {
    render(<AgentPageContent projectId="project-1" sessionId="session-1" agentId="agent-1" />);

    fireEvent.click(screen.getByTestId('create-agent-button'));

    expect(screen.queryByText('Model')).not.toBeInTheDocument();
  });

  it('should create agent and navigate to new agent', async () => {
    mockApiPost.mockResolvedValue({ threadId: 'new-agent-123' });

    render(<AgentPageContent projectId="project-1" sessionId="session-1" agentId="agent-1" />);

    fireEvent.click(screen.getByTestId('create-agent-button'));

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/sessions/session-1/agents', {
        name: 'default Agent',
        persona: 'default',
        initialMessage: undefined,
        // No provider/model parameters
      });
    });

    // Should navigate to new agent
    await waitFor(() => {
      expect(mockNavigateToAgent).toHaveBeenCalledWith('project-1', 'session-1', 'new-agent-123');
    });
  });

  it('should handle agent creation with message and navigate', async () => {
    mockApiPost.mockResolvedValue({ threadId: 'new-agent-456' });

    render(<AgentPageContent projectId="project-1" sessionId="session-1" agentId="agent-1" />);

    fireEvent.click(screen.getByTestId('create-agent-button'));

    const messageInput = screen.getByTestId('message-input-popup');
    fireEvent.change(messageInput, { target: { value: 'Help me debug this!' } });

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/sessions/session-1/agents', {
        name: 'default Agent',
        persona: 'default',
        initialMessage: 'Help me debug this!',
      });
    });

    // Should navigate to new agent
    await waitFor(() => {
      expect(mockNavigateToAgent).toHaveBeenCalledWith('project-1', 'session-1', 'new-agent-456');
    });
  });

  it('should close popup on successful creation', async () => {
    mockApiPost.mockResolvedValue({ threadId: 'new-agent-789' });

    render(<AgentPageContent projectId="project-1" sessionId="session-1" agentId="agent-1" />);

    fireEvent.click(screen.getByTestId('create-agent-button'));
    expect(screen.getByTestId('agent-create-popup')).toBeInTheDocument();

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.queryByTestId('agent-create-popup')).not.toBeInTheDocument();
    });
  });

  it('should keep popup open on creation error', async () => {
    mockApiPost.mockRejectedValue(new Error('Creation failed'));

    render(<AgentPageContent projectId="project-1" sessionId="session-1" agentId="agent-1" />);

    fireEvent.click(screen.getByTestId('create-agent-button'));

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalled();
    });

    // Popup should remain open for retry
    expect(screen.getByTestId('agent-create-popup')).toBeInTheDocument();
    // Navigation should not happen
    expect(mockNavigateToAgent).not.toHaveBeenCalled();
  });
});
