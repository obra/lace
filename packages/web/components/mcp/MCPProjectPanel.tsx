// ABOUTME: Project-level MCP configuration component with global server inheritance
// ABOUTME: Shows both inherited global servers and project-specific servers with override capabilities

'use client';

import React, { useState, useEffect } from 'react';
import { MCPSettingsPanel } from './MCPSettingsPanel';
import { api } from '@/lib/api-client';
import type { MCPServerConfig } from '@/types/core';
import type { ServerStatus, ToolPolicy } from './MCPServerCard';
import type { ConfigurationResponse } from '@/types/api';

interface ProjectMCPServersResponse {
  projectId: string;
  servers: Array<MCPServerConfig & { id: string }>;
}

interface GlobalMCPServersResponse {
  servers: Array<MCPServerConfig & { id: string }>;
}

interface MCPProjectPanelProps {
  projectId: string;
}

export function MCPProjectPanel({ projectId }: MCPProjectPanelProps) {
  const [projectServers, setProjectServers] = useState<Record<string, MCPServerConfig>>({});
  const [globalServers, setGlobalServers] = useState<Record<string, MCPServerConfig>>({});
  const [serverStatuses, setServerStatuses] = useState<Record<string, ServerStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load project and global MCP configuration
  useEffect(() => {
    const loadConfiguration = async () => {
      try {
        // Load project configuration
        const projectResponse = await fetch(`/api/projects/${projectId}/configuration`);
        if (!projectResponse.ok) {
          throw new Error(`Failed to load project config: ${projectResponse.statusText}`);
        }
        const projectData = await projectResponse.json();

        // Load global servers for reference
        const globalResponse = await fetch('/api/mcp/servers');
        if (!globalResponse.ok) {
          throw new Error(`Failed to load global servers: ${globalResponse.statusText}`);
        }
        const globalData = await globalResponse.json();

        // Load project-specific MCP servers
        const projectMcpResponse = await fetch(`/api/projects/${projectId}/mcp/servers`);
        if (!projectMcpResponse.ok) {
          throw new Error(`Failed to load project MCP servers: ${projectMcpResponse.statusText}`);
        }
        const projectMcpData = await projectMcpResponse.json();

        setGlobalServers(globalData.servers || {});
        setProjectServers(projectMcpData.servers || {});

        // Initialize server statuses
        const statuses: Record<string, ServerStatus> = {};
        Object.keys({ ...globalData.servers, ...projectMcpData.servers }).forEach((serverId) => {
          statuses[serverId] = 'stopped'; // Default to stopped
        });
        setServerStatuses(statuses);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load MCP configuration');
      } finally {
        setLoading(false);
      }
    };

    void loadConfiguration();
  }, [projectId]);

  const handleAddServer = () => {
    // TODO: Implement add project server modal
    console.log('Add project server clicked');
  };

  const handleStartServer = async (serverId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/mcp/servers/${serverId}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });

      if (!response.ok) {
        throw new Error(`Failed to start server: ${response.statusText}`);
      }

      setServerStatuses((prev) => ({ ...prev, [serverId]: 'running' }));
    } catch (err) {
      console.error('Failed to start server:', err);
      setServerStatuses((prev) => ({ ...prev, [serverId]: 'failed' }));
    }
  };

  const handleStopServer = async (serverId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/mcp/servers/${serverId}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });

      if (!response.ok) {
        throw new Error(`Failed to stop server: ${response.statusText}`);
      }

      setServerStatuses((prev) => ({ ...prev, [serverId]: 'stopped' }));
    } catch (err) {
      console.error('Failed to stop server:', err);
    }
  };

  const handleEditServer = (serverId: string) => {
    // TODO: Implement edit server modal
    console.log('Edit server:', serverId);
  };

  const handleDeleteServer = async (serverId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/mcp/servers/${serverId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to delete server: ${response.statusText}`);
      }

      setProjectServers((prev) => {
        const updated = { ...prev };
        delete updated[serverId];
        return updated;
      });

      setServerStatuses((prev) => {
        const updated = { ...prev };
        delete updated[serverId];
        return updated;
      });
    } catch (err) {
      console.error('Failed to delete server:', err);
    }
  };

  const handleToolPolicyChange = async (serverId: string, toolName: string, policy: ToolPolicy) => {
    try {
      // Check if this is a project-specific server or global override
      const isProjectServer = projectId in projectServers;
      const endpoint = isProjectServer
        ? `/api/projects/${projectId}/mcp/servers/${serverId}`
        : `/api/mcp/servers/${serverId}`;

      const currentConfig = projectServers[serverId] || globalServers[serverId];
      const updatedConfig = {
        ...currentConfig,
        tools: {
          ...currentConfig.tools,
          [toolName]: policy,
        },
      };

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });

      if (!response.ok) {
        throw new Error(`Failed to update tool policy: ${response.statusText}`);
      }

      if (isProjectServer) {
        setProjectServers((prev) => ({
          ...prev,
          [serverId]: updatedConfig,
        }));
      } else {
        setGlobalServers((prev) => ({
          ...prev,
          [serverId]: updatedConfig,
        }));
      }
    } catch (err) {
      console.error('Failed to update tool policy:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center p-8">
        <div className="loading loading-spinner loading-lg"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error">
        <span>Error loading MCP configuration: {error}</span>
      </div>
    );
  }

  return (
    <MCPSettingsPanel
      title="📁 Project MCP Settings"
      description="Configure MCP servers for this project. Project-specific servers are only available in this project, while global servers are inherited and can be overridden."
      servers={projectServers}
      globalServers={globalServers}
      serverStatuses={serverStatuses}
      onAddServer={handleAddServer}
      onStartServer={handleStartServer}
      onStopServer={handleStopServer}
      onEditServer={handleEditServer}
      onDeleteServer={handleDeleteServer}
      onToolPolicyChange={handleToolPolicyChange}
      isProjectLevel={true}
    />
  );
}
