// ABOUTME: Tests for the shared MCP server card component
// ABOUTME: Validates display consistency and interaction handling for both global and project servers

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MCPServerCard } from './MCPServerCard';
import type { MCPServerConfig } from '@/types/core';

// Mock FontAwesome icons
vi.mock('@fortawesome/react-fontawesome', () => ({
  FontAwesomeIcon: ({ icon, className }: any) => (
    <span data-testid="icon" data-icon={icon.iconName} className={className}>
      [{icon.iconName}]
    </span>
  ),
}));

describe('MCPServerCard', () => {
  const mockServerConfig: MCPServerConfig = {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    enabled: true,
    tools: {},
    discoveredTools: [
      { name: 'read_file', description: 'Read file contents' },
      { name: 'write_file', description: 'Write file contents' },
      { name: 'list_directory', description: 'List directory contents' },
    ],
    discoveryStatus: 'completed' as const,
  };

  it('should render global server correctly', () => {
    render(
      <MCPServerCard
        serverId="filesystem"
        config={mockServerConfig}
        isGlobal={true}
        showActions={false}
      />
    );

    // Check server name and command using test IDs
    expect(screen.getByTestId('server-name-filesystem')).toHaveTextContent('filesystem');
    expect(screen.getByTestId('server-command-filesystem')).toHaveTextContent(
      'npx -y @modelcontextprotocol/server-filesystem'
    );

    // Check tools are displayed as comma-separated list
    expect(screen.getByTestId('server-tools-filesystem')).toHaveTextContent(
      'Tools: read_file, write_file, list_directory'
    );

    // Should not show project-only badge
    expect(screen.queryByTestId('project-only-badge-filesystem')).not.toBeInTheDocument();

    // Should not show action buttons when showActions is false
    expect(screen.queryByTestId('server-actions-filesystem')).not.toBeInTheDocument();
  });

  it('should render project server correctly', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <MCPServerCard
        serverId="project-server"
        config={mockServerConfig}
        isGlobal={false}
        showActions={true}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    // Check server name and command using test IDs
    expect(screen.getByTestId('server-name-project-server')).toHaveTextContent('project-server');
    expect(screen.getByTestId('server-command-project-server')).toHaveTextContent(
      'npx -y @modelcontextprotocol/server-filesystem'
    );

    // Should show project-only badge
    expect(screen.getByTestId('project-only-badge-project-server')).toHaveTextContent(
      'project only'
    );

    // Should show action buttons
    expect(screen.getByTestId('edit-server-project-server')).toBeInTheDocument();
    expect(screen.getByTestId('delete-server-project-server')).toBeInTheDocument();
  });

  it('should handle edit and delete button clicks', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <MCPServerCard
        serverId="test-server"
        config={mockServerConfig}
        isGlobal={false}
        showActions={true}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    // Click edit button
    const editButton = screen.getByTestId('edit-server-test-server');
    fireEvent.click(editButton);
    expect(onEdit).toHaveBeenCalledWith('test-server');

    // Click delete button
    const deleteButton = screen.getByTestId('delete-server-test-server');
    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledWith('test-server');
  });

  it('should show discovery failed status', () => {
    const failedConfig: MCPServerConfig = {
      ...mockServerConfig,
      discoveryStatus: 'failed' as const,
      discoveryError: '-32000',
      discoveredTools: [],
    };

    render(
      <MCPServerCard
        serverId="failed-server"
        config={failedConfig}
        isGlobal={true}
        showActions={false}
      />
    );

    // Should show discovery failed message
    expect(screen.getByTestId('discovery-error-failed-server')).toHaveTextContent(
      'Discovery failed: MCP error -32000'
    );

    // Should not show tools section when discovery failed
    expect(screen.queryByTestId('server-tools-failed-server')).not.toBeInTheDocument();
  });

  it('should show discovering status', () => {
    const discoveringConfig: MCPServerConfig = {
      ...mockServerConfig,
      discoveryStatus: 'discovering' as const,
      discoveredTools: [],
    };

    render(
      <MCPServerCard
        serverId="discovering-server"
        config={discoveringConfig}
        isGlobal={true}
        showActions={false}
      />
    );

    // Should show spinner for discovering status
    expect(screen.getByTestId('server-name-discovering-server')).toHaveTextContent(
      'discovering-server'
    );
    expect(screen.getByTestId('discovering-spinner-discovering-server')).toBeInTheDocument();

    // Should not show tools section when still discovering
    expect(screen.queryByTestId('server-tools-discovering-server')).not.toBeInTheDocument();
  });

  it('should handle server with no discovered tools', () => {
    const noToolsConfig: MCPServerConfig = {
      ...mockServerConfig,
      discoveredTools: [],
    };

    render(
      <MCPServerCard
        serverId="no-tools-server"
        config={noToolsConfig}
        isGlobal={true}
        showActions={false}
      />
    );

    // Should not show tools section when no tools are discovered
    expect(screen.queryByTestId('server-tools-no-tools-server')).not.toBeInTheDocument();
  });

  it('should handle server with undefined discovered tools', () => {
    const undefinedToolsConfig: MCPServerConfig = {
      ...mockServerConfig,
      discoveredTools: undefined,
    };

    render(
      <MCPServerCard
        serverId="undefined-tools-server"
        config={undefinedToolsConfig}
        isGlobal={true}
        showActions={false}
      />
    );

    // Should not show tools section when tools are undefined
    expect(screen.queryByTestId('server-tools-undefined-tools-server')).not.toBeInTheDocument();
  });

  it('should apply custom className', () => {
    render(
      <MCPServerCard
        serverId="custom-server"
        config={mockServerConfig}
        isGlobal={true}
        showActions={false}
        className="custom-class"
      />
    );

    // Check that custom class is applied
    expect(screen.getByTestId('mcp-server-card-custom-server')).toHaveClass('custom-class');
  });

  it('should handle server with no args', () => {
    const noArgsConfig: MCPServerConfig = {
      ...mockServerConfig,
      args: undefined,
    };

    render(
      <MCPServerCard
        serverId="no-args-server"
        config={noArgsConfig}
        isGlobal={true}
        showActions={false}
      />
    );

    // Should show just the command without args
    expect(screen.getByTestId('server-command-no-args-server')).toHaveTextContent('npx');
  });

  it('should handle server with empty args array', () => {
    const emptyArgsConfig: MCPServerConfig = {
      ...mockServerConfig,
      args: [],
    };

    render(
      <MCPServerCard
        serverId="empty-args-server"
        config={emptyArgsConfig}
        isGlobal={true}
        showActions={false}
      />
    );

    // Should show just the command
    expect(screen.getByTestId('server-command-empty-args-server')).toHaveTextContent('npx');
  });

  it('should show correct styling for global vs project servers', () => {
    const { rerender, container } = render(
      <MCPServerCard
        serverId="global-server"
        config={mockServerConfig}
        isGlobal={true}
        showActions={false}
      />
    );

    // Global server should have base-300 border
    expect(screen.getByTestId('mcp-server-card-global-server')).toHaveClass('border-base-300');

    rerender(
      <MCPServerCard
        serverId="project-server"
        config={mockServerConfig}
        isGlobal={false}
        showActions={false}
      />
    );

    // Project server should have primary border
    expect(screen.getByTestId('mcp-server-card-project-server')).toHaveClass('border-primary');
  });

  it('should render icons correctly', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <MCPServerCard
        serverId="icon-test-server"
        config={mockServerConfig}
        isGlobal={false}
        showActions={true}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    // Check that edit and trash buttons are rendered
    expect(screen.getByTestId('edit-server-icon-test-server')).toBeInTheDocument();
    expect(screen.getByTestId('delete-server-icon-test-server')).toBeInTheDocument();
  });
});
