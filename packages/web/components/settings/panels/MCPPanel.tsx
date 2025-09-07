// ABOUTME: MCP configuration panel for global settings with server management
// ABOUTME: Provides global MCP server configuration interface integrated with settings system

'use client';

import React, { useState, useEffect } from 'react';
import { MCPSettingsPanel } from '@/components/mcp/MCPSettingsPanel';
import { api } from '@/lib/api-client';
import type { MCPServerConfig } from '@/types/core';
import type { ServerStatus, ToolPolicy } from '@/components/mcp/MCPServerCard';

interface GlobalMCPServersResponse {
  servers: Array<MCPServerConfig & { id: string }>;
}

export function MCPPanel() {
  const [servers, setServers] = useState<Record<string, MCPServerConfig>>({});
  const [serverStatuses, setServerStatuses] = useState<Record<string, ServerStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load global MCP configuration
  useEffect(() => {
    const loadServers = async () => {
      try {
        const data = await api.get<GlobalMCPServersResponse>('/api/mcp/servers');

        // Convert array to record format
        const serversRecord: Record<string, MCPServerConfig> = {};
        data.servers.forEach((server) => {
          const { id, ...config } = server;
          serversRecord[id] = config;
        });

        setServers(serversRecord);

        // Initialize server statuses - default to discovering if status not known
        const statuses: Record<string, ServerStatus> = {};
        data.servers.forEach((server) => {
          statuses[server.id] =
            server.discoveryStatus === 'discovering' ? 'discovering' : 'stopped';
        });
        setServerStatuses(statuses);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to load MCP servers');
      } finally {
        setLoading(false);
      }
    };

    void loadServers();
  }, []);

  const handleAddServer = () => {
    // TODO: Implement add server modal
  };

  const handleStartServer = async (serverId: string) => {
    try {
      await api.post(`/api/mcp/servers/${serverId}/control`, { action: 'start' });
      setServerStatuses((prev) => ({ ...prev, [serverId]: 'running' }));
    } catch (error) {
      setServerStatuses((prev) => ({ ...prev, [serverId]: 'failed' }));
    }
  };

  const handleStopServer = async (serverId: string) => {
    try {
      await api.post(`/api/mcp/servers/${serverId}/control`, { action: 'stop' });
      setServerStatuses((prev) => ({ ...prev, [serverId]: 'stopped' }));
    } catch (error) {
      // Error handling - status remains unchanged
    }
  };

  const handleEditServer = (serverId: string) => {
    // TODO: Implement edit server modal
    void serverId;
  };

  const handleDeleteServer = async (serverId: string) => {
    try {
      await api.delete(`/api/mcp/servers/${serverId}`);

      setServers((prev) => {
        const updated = { ...prev };
        delete updated[serverId];
        return updated;
      });

      setServerStatuses((prev) => {
        const updated = { ...prev };
        delete updated[serverId];
        return updated;
      });
    } catch (error) {
      // Error handling - could show toast notification
    }
  };

  const handleToolPolicyChange = async (serverId: string, toolName: string, policy: ToolPolicy) => {
    try {
      const currentConfig = servers[serverId];
      const updatedConfig = {
        ...currentConfig,
        tools: {
          ...currentConfig.tools,
          [toolName]: policy,
        },
      };

      await api.put(`/api/mcp/servers/${serverId}`, updatedConfig);

      setServers((prev) => ({
        ...prev,
        [serverId]: updatedConfig,
      }));
    } catch (error) {
      // Error handling - could revert the change or show error
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
        <span>Error loading MCP servers: {error}</span>
      </div>
    );
  }

  return (
    <MCPSettingsPanel
      title="🌍 Global MCP Settings"
      description="Configure MCP servers available to all projects. These settings apply globally and can be overridden at the project level."
      servers={servers}
      serverStatuses={serverStatuses}
      onAddServer={handleAddServer}
      onStartServer={handleStartServer}
      onStopServer={handleStopServer}
      onEditServer={handleEditServer}
      onDeleteServer={handleDeleteServer}
      onToolPolicyChange={handleToolPolicyChange}
      isProjectLevel={false}
    />
  );
}
