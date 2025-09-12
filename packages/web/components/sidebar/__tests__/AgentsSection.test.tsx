// ABOUTME: Unit tests for AgentsSection component using real implementations
// ABOUTME: Tests agent listing, selection, and add agent button functionality

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AgentsSection } from '@/components/sidebar/AgentsSection';
import { setupWebTest } from '@/test-utils/web-test-setup';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';

// Mock external dependencies only (following testing docs)
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server/approval-manager', () => ({
  getApprovalManager: () => ({
    requestApproval: vi.fn().mockResolvedValue('allow_once'),
  }),
}));

// Mock the context hooks since AgentsSection needs them but we're testing the component in isolation
vi.mock('@/components/providers/AgentProvider', () => ({
  useAgentContext: () => ({
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

vi.mock('@/components/providers/TaskProvider', () => ({
  useOptionalTaskContext: () => ({
    taskManager: {
      tasks: [],
      isLoading: false,
      isCreating: false,
      isUpdating: false,
      isDeleting: false,
      error: null,
      refetch: vi.fn(),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      completeTask: vi.fn(),
      handleTaskUpdated: vi.fn(),
      handleTaskDeleted: vi.fn(),
      handleTaskNoteAdded: vi.fn(),
    },
  }),
}));

describe('AgentsSection', () => {
  const _tempLaceDir = setupWebTest(); // Following testing docs pattern
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();

    // Set up environment following testing docs
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
});
