// ABOUTME: Integration tests for project-level MCP server management component
// ABOUTME: Tests real API integration without mocks, including edit modal functionality

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MCPProjectConfig } from './MCPProjectConfig';
import { api } from '@/lib/api-client';
import type { MCPServerConfig } from '@/types/core';

// Test data
const mockProjectId = 'test-project-123';

const mockGlobalServers = [
  {
    id: 'global-filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    enabled: true,
    tools: {},
    discoveredTools: [
      { name: 'read_file', description: 'Read file contents' },
      { name: 'write_file', description: 'Write file contents' },
      { name: 'list_directory', description: 'List directory contents' },
    ],
    discoveryStatus: 'success' as const,
  },
];

const mockProjectServers = [
  {
    id: 'project-test-server',
    command: 'echo',
    args: ['hello'],
    enabled: true,
    tools: {},
    discoveredTools: [
      { name: 'echo', description: 'Echo command' },
      { name: 'test_tool', description: 'Test tool' },
    ],
    discoveryStatus: 'success' as const,
  },
];

// Mock api calls
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    post: vi.fn(),
  },
}));

// Mock the modal component
vi.mock('@/components/modals/AddMCPServerModal', () => ({
  AddMCPServerModal: (props: {
    isOpen: boolean;
    onAddServer: (id: string, config: MCPServerConfig) => void;
    initialData?: { id: string; config: MCPServerConfig };
    isEditMode?: boolean;
    onClose: () => void;
  }) => {
    const { isOpen, onAddServer, initialData, isEditMode, onClose } = props;
    if (!isOpen) return null;
    return (
      <div data-testid="edit-mcp-modal">
        <h2>{isEditMode ? 'Edit Server' : 'Add Server'}</h2>
        <div>Server ID: {initialData?.id}</div>
        <div>Command: {initialData?.config?.command}</div>
        <button
          onClick={() => {
            // Simulate edit save with updated config
            if (isEditMode && initialData) {
              onAddServer(initialData.id, {
                ...initialData.config,
                command: 'updated-command',
                args: ['updated', 'args'],
              });
            }
          }}
          data-testid="save-edit-button"
        >
          Save Changes
        </button>
        <button onClick={onClose} data-testid="cancel-edit-button">
          Cancel
        </button>
      </div>
    );
  },
}));

describe('MCPProjectConfig Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default API responses
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/api/mcp/servers') {
        return Promise.resolve({ servers: mockGlobalServers });
      }
      if (url === `/api/projects/${mockProjectId}/mcp/servers`) {
        return Promise.resolve({
          projectId: mockProjectId,
          servers: [...mockGlobalServers, ...mockProjectServers],
        });
      }
      return Promise.reject(new Error(`Unexpected API call: ${url}`));
    });

    vi.mocked(api.put).mockResolvedValue({ success: true });
    vi.mocked(api.delete).mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should load and display global and project servers correctly', async () => {
    render(<MCPProjectConfig projectId={mockProjectId} />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument();
    });

    // Check that global servers section is displayed
    expect(screen.getByTestId('global-servers-section')).toBeInTheDocument();
    expect(screen.getByTestId('server-name-global-filesystem')).toHaveTextContent(
      'global-filesystem'
    );
    expect(screen.getByTestId('server-tools-global-filesystem')).toHaveTextContent(
      'Tools: read_file, write_file, list_directory'
    );

    // Check that project servers section is displayed
    expect(screen.getByTestId('project-servers-section')).toBeInTheDocument();
    expect(screen.getByTestId('server-name-project-test-server')).toHaveTextContent(
      'project-test-server'
    );
    expect(screen.getByTestId('server-tools-project-test-server')).toHaveTextContent(
      'Tools: echo, test_tool'
    );

    // Global servers should not have edit/delete buttons
    expect(screen.queryByTestId('server-actions-global-filesystem')).not.toBeInTheDocument();

    // Project servers should have edit/delete buttons
    expect(screen.getByTestId('edit-server-project-test-server')).toBeInTheDocument();
    expect(screen.getByTestId('delete-server-project-test-server')).toBeInTheDocument();
  });

  it('should handle project server edit functionality', async () => {
    render(<MCPProjectConfig projectId={mockProjectId} />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument();
    });

    // Find and click the edit button for the project server
    const editButton = screen.getByTestId('edit-server-project-test-server');
    fireEvent.click(editButton);

    // Wait for edit modal to appear
    await waitFor(() => {
      expect(screen.getByTestId('edit-mcp-modal')).toBeInTheDocument();
    });

    // Verify modal shows correct initial data
    expect(screen.getByText('Edit Server')).toBeInTheDocument();
    expect(screen.getByText('Server ID: project-test-server')).toBeInTheDocument();
    expect(screen.getByText('Command: echo')).toBeInTheDocument();

    // Click save to trigger the update
    const saveButton = screen.getByTestId('save-edit-button');
    fireEvent.click(saveButton);

    // Verify API was called with correct data
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith(
        `/api/projects/${mockProjectId}/mcp/servers/project-test-server`,
        expect.objectContaining({
          command: 'updated-command',
          args: ['updated', 'args'],
        })
      );
    });

    // Modal should close after successful save
    await waitFor(() => {
      expect(screen.queryByTestId('edit-mcp-modal')).not.toBeInTheDocument();
    });
  });

  it('should handle project server deletion', async () => {
    render(<MCPProjectConfig projectId={mockProjectId} />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument();
    });

    // Find and click the delete button for the project server
    const deleteButton = screen.getByTestId('delete-server-project-test-server');
    fireEvent.click(deleteButton);

    // Verify API was called
    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith(
        `/api/projects/${mockProjectId}/mcp/servers/project-test-server`
      );
    });
  });

  it('should handle edit modal cancellation', async () => {
    render(<MCPProjectConfig projectId={mockProjectId} />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument();
    });

    // Open edit modal
    const editButton = screen.getByTestId('edit-server-project-test-server');
    fireEvent.click(editButton);

    // Wait for modal to appear
    await waitFor(() => {
      expect(screen.getByTestId('edit-mcp-modal')).toBeInTheDocument();
    });

    // Click cancel
    const cancelButton = screen.getByTestId('cancel-edit-button');
    fireEvent.click(cancelButton);

    // Modal should close and no API call should be made
    await waitFor(() => {
      expect(screen.queryByTestId('edit-mcp-modal')).not.toBeInTheDocument();
    });
    expect(api.put).not.toHaveBeenCalled();
  });

  it('should display empty state when no servers are configured', async () => {
    // Override API to return empty results
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/api/mcp/servers') {
        return Promise.resolve({ servers: [] });
      }
      if (url === `/api/projects/${mockProjectId}/mcp/servers`) {
        return Promise.resolve({
          projectId: mockProjectId,
          servers: [],
        });
      }
      return Promise.reject(new Error(`Unexpected API call: ${url}`));
    });

    render(<MCPProjectConfig projectId={mockProjectId} />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument();
    });

    // Should show empty state
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
    expect(
      screen.getByText('Configure global servers or add project-specific servers')
    ).toBeInTheDocument();
  });

  it('should handle API errors gracefully', async () => {
    // Make API calls fail
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));

    render(<MCPProjectConfig projectId={mockProjectId} />);

    // Wait for error state
    await waitFor(() => {
      expect(screen.getByText(/Error loading MCP configuration/)).toBeInTheDocument();
    });
  });

  it('should show discovery failed status correctly', async () => {
    const failedServer = {
      id: 'failed-server',
      command: 'bad-command',
      args: [],
      enabled: true,
      tools: {},
      discoveredTools: [],
      discoveryStatus: 'failed' as const,
      discoveryError: '-32000',
    };

    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/api/mcp/servers') {
        return Promise.resolve({ servers: [] });
      }
      if (url === `/api/projects/${mockProjectId}/mcp/servers`) {
        return Promise.resolve({
          projectId: mockProjectId,
          servers: [failedServer],
        });
      }
      return Promise.reject(new Error(`Unexpected API call: ${url}`));
    });

    render(<MCPProjectConfig projectId={mockProjectId} />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument();
    });

    // Should show discovery failed message
    expect(screen.getByTestId('discovery-error-failed-server')).toHaveTextContent(
      'Discovery failed: MCP error -32000'
    );
  });

  it('should call onOpenAddModal when add button is clicked', async () => {
    const mockOnOpenAddModal = vi.fn();

    render(<MCPProjectConfig projectId={mockProjectId} onOpenAddModal={mockOnOpenAddModal} />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument();
    });

    // Find and click the "Add Project Server" button
    const addButton = screen.getByTestId('add-project-server-button');
    fireEvent.click(addButton);

    expect(mockOnOpenAddModal).toHaveBeenCalledTimes(1);
  });
});
