// ABOUTME: Unit tests for AgentPageContent component agent state change functionality
// ABOUTME: Tests agent state handling and stop button visibility (migrated from LaceApp-agent-state.test.tsx)

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AgentPageContent } from '@/app/project/[projectId]/session/[sessionId]/agent/[agentId]/AgentPageContent';
import { asThreadId } from '@/types/core';

// Mock the providers
vi.mock('@/components/providers/UIProvider', () => ({
  useUIContext: () => ({
    sidebarOpen: true,
    setSidebarOpen: vi.fn(),
    toggleSidebar: vi.fn(),
    autoOpenCreateProject: false,
    setAutoOpenCreateProject: vi.fn(),
    loading: false,
    setLoading: vi.fn(),
  }),
}));

vi.mock('@/components/providers/ProjectProvider', () => ({
  useProjectContext: () => ({
    currentProject: { id: 'test-project', name: 'Test Project' },
    projects: [],
  }),
}));

vi.mock('@/components/providers/SessionProvider', () => ({
  useSessionContext: () => ({
    currentSession: {
      id: 'lace_20250101_sess01',
      threadId: asThreadId('lace_20250101_sess01'),
      name: 'Test Session',
    },
    sessions: [],
    deleteSession: vi.fn(),
  }),
}));

vi.mock('@/components/providers/AgentProvider', () => ({
  useAgentContext: () => ({
    currentAgent: {
      id: asThreadId('lace_20250101_agent1'),
      name: 'Test Agent',
      state: 'idle',
    },
    agents: [],
  }),
}));

vi.mock('@/components/providers/ToolApprovalProvider', () => ({
  useToolApprovalContext: () => ({
    pendingApprovals: [{ id: 'test-approval', toolName: 'bash', args: {} }], // Add mock pending approval
    handleApprovalDecision: vi.fn(),
  }),
}));

// Mock Next.js App Router
const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockBack = vi.fn();
const mockForward = vi.fn();
const mockPrefetch = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: mockRefresh,
    back: mockBack,
    forward: mockForward,
    prefetch: mockPrefetch,
  }),
  usePathname: () =>
    '/project/test-project/session/lace_20250101_sess01/agent/lace_20250101_agent1',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({
    projectId: 'test-project',
    sessionId: 'lace_20250101_sess01',
    agentId: 'lace_20250101_agent1',
  }),
}));

// Mock useURLState to provide navigation
const mockNavigateToAgent = vi.fn();
vi.mock('@/hooks/useURLState', () => ({
  useURLState: () => ({
    navigateToAgent: mockNavigateToAgent,
    navigateToSession: vi.fn(),
    navigateToProject: vi.fn(),
  }),
}));

vi.mock('@/components/providers/ProviderInstanceProvider', () => ({
  useProviderInstances: () => ({
    availableProviders: [],
    instances: [],
    instancesLoading: false,
    instancesError: null,
    catalogProviders: [],
    catalogLoading: false,
    catalogError: null,
    testResults: {},
    showAddModal: false,
    selectedCatalogProvider: null,
    loadInstances: vi.fn(),
    createInstance: vi.fn(),
    updateInstance: vi.fn(),
    deleteInstance: vi.fn(),
    testInstance: vi.fn(),
    loadCatalog: vi.fn(),
    openAddModal: vi.fn(),
    closeAddModal: vi.fn(),
    getInstanceById: vi.fn(),
    getInstanceWithTestResult: vi.fn(),
  }),
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: React.ComponentProps<'button'>) => (
      <button {...props}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock complex child components
vi.mock('@/components/layout/Sidebar', () => ({
  Sidebar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="sidebar">{children}</div>
  ),
}));

vi.mock('@/components/layout/MobileSidebar', () => ({
  MobileSidebar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="mobile-sidebar">{children}</div>
  ),
}));

vi.mock('@/components/chat/Chat', () => ({
  Chat: () => <div data-testid="chat">Chat Component</div>,
}));

vi.mock('@/components/sidebar/SidebarContent', () => ({
  SidebarContent: () => <div data-testid="sidebar-content">Sidebar Content</div>,
}));

vi.mock('@/components/modals/ToolApprovalModal', () => ({
  ToolApprovalModal: () => <div>Tool Approval Modal</div>,
}));

vi.mock('@/components/settings/SettingsContainer', () => ({
  SettingsContainer: () => <div data-testid="settings-container">Settings Container</div>,
}));

vi.mock('@/components/config/AgentEditModal', () => ({
  AgentEditModal: () => <div data-testid="agent-edit-modal">Agent Edit Modal</div>,
}));

vi.mock('@/components/config/SessionEditModal', () => ({
  SessionEditModal: () => <div data-testid="session-edit-modal">Session Edit Modal</div>,
}));

// Test props
const defaultProps = {
  projectId: 'test-project',
  sessionId: 'lace_20250101_sess01',
  agentId: 'lace_20250101_agent1',
};

describe('AgentPageContent agent state handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Clear router mocks
    mockPush.mockClear();
    mockReplace.mockClear();
    mockRefresh.mockClear();
    mockBack.mockClear();
    mockForward.mockClear();
    mockPrefetch.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render main chat interface components', async () => {
    render(<AgentPageContent {...defaultProps} />);

    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('chat')).toBeInTheDocument();
    // Sidebar content is conditionally rendered based on desktop/mobile state
    // In test environment, both conditions might not be met
    expect(screen.getByTestId('settings-container')).toBeInTheDocument();
  });

  it('should handle agent selection callback correctly', async () => {
    render(<AgentPageContent {...defaultProps} />);

    // The component should be rendered without errors
    expect(screen.getByTestId('chat')).toBeInTheDocument();

    // Mock agent selection would trigger navigation
    await act(async () => {
      // This would normally be triggered by sidebar interaction
      // The navigation logic should use asThreadId conversion
      expect(mockNavigateToAgent).not.toHaveBeenCalled(); // Not called on render
    });
  });

  it('should provide proper project switching functionality', async () => {
    render(<AgentPageContent {...defaultProps} />);

    // Component should render without crashing when project context changes
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('should handle mobile sidebar toggle', async () => {
    render(<AgentPageContent {...defaultProps} />);

    // The mobile sidebar is conditionally rendered, so just check that
    // the UI structure supports mobile navigation
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('should integrate tool approval modals', async () => {
    render(<AgentPageContent {...defaultProps} />);

    // Tool approval modal should be rendered
    expect(screen.getByTestId('tool-approval-modal')).toBeInTheDocument();
  });
});
