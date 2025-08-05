// ABOUTME: Integration tests for LaceApp task management functionality
// ABOUTME: Tests Tasks button integration and TaskBoardModal workflow

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { LaceApp } from '@/components/pages/LaceApp';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { useHashRouter } from '@/hooks/useHashRouter';
import { useTaskManager } from '@/hooks/useTaskManager';
import { createFetchMock } from '@/test-utils/mock-fetch';
import { asThreadId } from '@/types/core';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock all the child components that we're not testing
vi.mock('@/components/layout/Sidebar', () => ({
  Sidebar: ({ children }: { children?: React.ReactNode }) => <div data-testid="sidebar">{children}</div>,
  SidebarSection: ({ children, title }: { children?: React.ReactNode; title?: string }) => (
    <div data-testid="sidebar-section">
      {title && <div data-testid="sidebar-section-title">{title}</div>}
      {children}
    </div>
  ),
  SidebarItem: ({ children }: { children?: React.ReactNode }) => <div data-testid="sidebar-item">{children}</div>,
  SidebarButton: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => 
    <button data-testid="sidebar-button" onClick={onClick}>{children}</button>,
}));

vi.mock('@/components/layout/MobileSidebar', () => ({
  MobileSidebar: ({ children }: { children?: React.ReactNode }) => <div data-testid="mobile-sidebar">{children}</div>,
}));

vi.mock('@/components/timeline/TimelineView', () => ({
  TimelineView: () => <div data-testid="timeline-view">Timeline</div>,
}));

vi.mock('@/components/chat/EnhancedChatInput', () => ({
  EnhancedChatInput: () => <div data-testid="chat-input">Chat Input</div>,
}));

vi.mock('@/components/modals/ToolApprovalModal', () => ({
  ToolApprovalModal: () => <div data-testid="tool-approval-modal">Tool Approval Modal</div>,
}));

vi.mock('@/components/config/SessionConfigPanel', () => ({
  SessionConfigPanel: () => <div data-testid="session-config-panel">Session Config Panel</div>,
}));

vi.mock('@/components/config/ProjectSelectorPanel', () => ({
  ProjectSelectorPanel: () => <div data-testid="project-selector-panel">Project Selector Panel</div>,
}));

vi.mock('@/lib/timeline-converter', () => ({
  convertSessionEventsToTimeline: () => [],
}));

vi.mock('@/types/events', () => ({
  getAllEventTypes: () => [],
}));

vi.mock('@/hooks/useSessionEvents', () => ({
  useSessionEvents: () => ({
    events: [],
    isConnected: false,
    error: null,
  }),
}));

// Mock the necessary hooks and components
vi.mock('@/hooks/useHashRouter', () => ({
  useHashRouter: vi.fn(),
}));

vi.mock('@/hooks/useTaskManager', () => ({
  useTaskManager: vi.fn(),
}));

// Helper to render with real theme provider
const renderWithProviders = (component: React.ReactElement) => {
  return render(
    <ThemeProvider>
      {component}
    </ThemeProvider>
  );
};


describe('LaceApp Task Sidebar Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock fetch using the new utility that handles superjson properly
    global.fetch = vi.fn().mockImplementation(createFetchMock({
      '/api/projects': { 
        projects: [{
          id: 'test-project',
          name: 'Test Project',
          description: 'Test project description',
          workingDirectory: '/test',
          isArchived: false,
          createdAt: new Date(),
          lastUsedAt: new Date(),
          sessionCount: 1
        }]
      },
      '/api/providers': { providers: [] },
      '/api/sessions/test-session': { 
        session: { 
          id: 'test-session', 
          name: 'Test Session',
          agents: [] 
        } 
      }
    }));
    
    // Default hash router mock with session
    vi.mocked(useHashRouter).mockReturnValue({
      project: 'test-project',
      session: asThreadId('test-session'),
      agent: null,
      setProject: vi.fn(),
      setSession: vi.fn(),
      setAgent: vi.fn(),
      clearAll: vi.fn(),
      state: {},
      updateState: vi.fn(),
      isHydrated: true,
    });
    
    // Default task manager mock
    vi.mocked(useTaskManager).mockReturnValue({
      tasks: [],
      isLoading: false,
      isCreating: false,
      isUpdating: false,
      isDeleting: false,
      error: null,
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      addNote: vi.fn(),
      refetch: vi.fn(),
      handleTaskCreated: vi.fn(),
      handleTaskUpdated: vi.fn(),
      handleTaskDeleted: vi.fn(),
      handleTaskNoteAdded: vi.fn(),
    });
  });

  it('should show task sidebar when session is selected', async () => {
    renderWithProviders(<LaceApp />);

    // Check if the task section elements are there
    await waitFor(() => {
      expect(screen.getByText('Add task')).toBeInTheDocument(); // Add task button
    }, { timeout: 3000 });
  });

  it('should not show task sidebar when no session selected', async () => {
    // Mock hook to return no session
    vi.mocked(useHashRouter).mockReturnValue({
      project: 'test-project',
      session: null,
      agent: null,
      setProject: vi.fn(),
      setSession: vi.fn(),
      setAgent: vi.fn(),
      clearAll: vi.fn(),
      state: {},
      updateState: vi.fn(),
      isHydrated: true,
    });

    renderWithProviders(<LaceApp />);

    await waitFor(() => {
      expect(screen.queryByText('Add task')).not.toBeInTheDocument();
    });
  });

  it('should show task count in section header when tasks exist', async () => {
    // Mock with some tasks - do this before rendering
    const mockTaskManager = {
      tasks: [
        {
          id: 'task-1',
          title: 'Test Task',
          description: 'Test',
          prompt: 'Test',
          status: 'pending' as const,
          priority: 'high' as const,
          assignedTo: 'human',
          createdBy: asThreadId('test-user'),
          threadId: asThreadId('test-session'),
          createdAt: new Date(),
          updatedAt: new Date(),
          notes: [],
        },
      ],
      isLoading: false,
      isCreating: false,
      isUpdating: false,
      isDeleting: false,
      error: null,
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      addNote: vi.fn(),
      refetch: vi.fn(),
      handleTaskCreated: vi.fn(),
      handleTaskUpdated: vi.fn(),
      handleTaskDeleted: vi.fn(),
      handleTaskNoteAdded: vi.fn(),
    };
    
    vi.mocked(useTaskManager).mockReturnValue(mockTaskManager);

    renderWithProviders(<LaceApp />);

    await waitFor(() => {
      // Check that the Tasks section exists with task count and shows the task itself
      expect(screen.getByText('Tasks (1)')).toBeInTheDocument(); // Section header with count
      expect(screen.getByText('Test Task')).toBeInTheDocument(); // Task item
      expect(screen.getByText('1 tasks • 0 in progress')).toBeInTheDocument(); // Task summary
    });
  });
});
