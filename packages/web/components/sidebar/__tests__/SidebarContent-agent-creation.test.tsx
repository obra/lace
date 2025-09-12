// ABOUTME: Integration tests for SidebarContent agent creation functionality
// ABOUTME: Tests modal integration and agent creation flow using real implementations

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SidebarContent } from '@/components/sidebar/SidebarContent';
import { setupWebTest } from '@/test-utils/web-test-setup';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';

// Mock external dependencies only
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server/approval-manager', () => ({
  getApprovalManager: () => ({
    requestApproval: vi.fn().mockResolvedValue('allow_once'),
  }),
}));

// Mock context providers with complete interfaces
vi.mock('@/components/providers/ProjectProvider', () => ({
  useProjectContext: () => ({
    selectedProject: { id: 'project-1', name: 'Test Project' },
  }),
}));

vi.mock('@/components/providers/AgentProvider', () => ({
  useOptionalAgentContext: () => ({
    sessionDetails: {
      id: 'session-1',
      name: 'Test Session',
      createdAt: new Date(),
      agents: [
        {
          threadId: 'agent-1',
          name: 'Test Agent',
          status: 'idle',
          persona: 'lace',
          providerInstanceId: 'test-provider',
          modelId: 'test-model',
        },
      ],
    },
    selectedAgent: null,
    loading: false,
    foundAgent: null,
    currentAgent: null,
    agentBusy: false,
    loadAgentConfiguration: vi.fn(),
    updateAgent: vi.fn(),
    reloadSessionDetails: vi.fn(),
    createAgentFromSession: vi.fn(),
    deleteAgent: vi.fn(),
  }),
}));

// Mock the child components to isolate SidebarContent testing
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

// Mock AgentsSection with the onCreateAgent prop
vi.mock('@/components/sidebar/AgentsSection', () => ({
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

describe('SidebarContent Agent Creation Integration', () => {
  const _tempLaceDir = setupWebTest();
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();

    process.env = {
      ...process.env,
      LACE_DB_PATH: ':memory:',
    };

    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    vi.clearAllMocks();
  });

  afterEach(async () => {
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
    vi.clearAllMocks();
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
});
