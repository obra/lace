// ABOUTME: MCP configuration panel for global settings with simplified inline implementation
// ABOUTME: Provides global MCP server configuration interface integrated with settings system

'use client';

import React, { useState, useEffect } from 'react';
import { AddMCPServerModal } from '@/components/modals/AddMCPServerModal';
import { api } from '@/lib/api-client';
import type { MCPServerConfig } from '@/types/core';
import { ToolPolicySelector } from '@/components/ui/ToolPolicySelector';
import type { ToolPolicy } from '@/components/ui/ToolPolicyToggle';

type ServerStatus = 'running' | 'stopped' | 'failed' | 'discovering';

interface GlobalMCPServersResponse {
  servers: Array<MCPServerConfig & { id: string }>;
}

export function MCPPanel() {
  const [servers, setServers] = useState<Record<string, MCPServerConfig>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingServer, setAddingServer] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);

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
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to load MCP servers');
      } finally {
        setLoading(false);
      }
    };

    void loadServers();
  }, []);

  const handleAddServer = () => {
    setShowAddModal(true);
  };

  const handleCloseAddModal = () => {
    setShowAddModal(false);
  };

  const handleCreateServer = async (serverId: string, config: MCPServerConfig) => {
    setAddingServer(true);
    try {
      await api.post('/api/mcp/servers', { id: serverId, ...config });

      // Add to local state immediately
      setServers((prev) => ({ ...prev, [serverId]: config }));
      setShowAddModal(false);
    } catch (error) {
      // Error handling
    } finally {
      setAddingServer(false);
    }
  };

  const handleEditServer = (serverId: string) => {
    setEditingServerId(serverId);
  };

  const handleCloseEditModal = () => {
    setEditingServerId(null);
  };

  const handleUpdateServer = async (serverId: string, config: MCPServerConfig) => {
    try {
      await api.put(`/api/mcp/servers/${serverId}`, config);

      // Update local state
      setServers((prev) => ({ ...prev, [serverId]: config }));
      setEditingServerId(null);
    } catch (error) {
      // Error handling
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    try {
      await api.delete(`/api/mcp/servers/${serverId}`);

      setServers((prev) => {
        const updated = { ...prev };
        delete updated[serverId];
        return updated;
      });
    } catch (error) {
      // Error handling
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
      // Error handling
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold mb-2">🌍 Global MCP Settings</h2>
        <p className="text-base-content/70">
          Configure MCP servers available to all projects. These settings apply globally and can be
          overridden at the project level.
        </p>
      </div>

      {/* Add Server Button */}
      <div className="flex justify-end">
        <button className="btn btn-primary btn-sm" onClick={handleAddServer}>
          Add Server
        </button>
      </div>

      {/* Server List */}
      <div className="space-y-4">
        {Object.entries(servers).map(([serverId, config]) => (
          <div
            key={serverId}
            className="border-l-4 border-base-300 pl-4 py-3 bg-base-50 rounded-lg"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 bg-base-400 rounded-full"></span>
                <span className="font-semibold">{serverId}</span>
                <code className="bg-base-200 px-2 py-1 rounded text-xs">
                  {config.command} {config.args?.join(' ')}
                </code>
                {config.discoveryStatus === 'discovering' && (
                  <span className="loading loading-spinner loading-xs"></span>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  className="btn btn-xs btn-outline"
                  onClick={() => handleEditServer(serverId)}
                  title="Edit Server"
                >
                  Edit
                </button>
                <button
                  className="btn btn-xs btn-outline btn-error"
                  onClick={() => handleDeleteServer(serverId)}
                  title="Delete Server"
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Discovery Status */}
            {config.discoveryStatus === 'failed' && (
              <div className="text-xs text-error mb-2 ml-5">
                Discovery failed: {config.discoveryError}
              </div>
            )}

            {/* Tools */}
            {config.discoveredTools && config.discoveredTools.length > 0 && (
              <div className="ml-5 space-y-1">
                {config.discoveredTools.map((tool, index) => {
                  const isLast = index === config.discoveredTools!.length - 1;
                  const currentPolicy = config.tools[tool.name] || 'ask';

                  return (
                    <div key={tool.name} className="flex items-center gap-3 text-sm">
                      <ToolPolicySelector
                        value={currentPolicy as ToolPolicy}
                        onChange={(policy) => handleToolPolicyChange(serverId, tool.name, policy)}
                        size="xs"
                        context="global"
                      />
                      <span className="font-mono">
                        {isLast ? '└─' : '├─'} {tool.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {Object.keys(servers).length === 0 && (
          <div className="text-center text-base-content/60 py-8">
            <div className="text-sm font-medium mb-1">No MCP servers configured</div>
            <div className="text-xs mb-3">
              Add your first MCP server to extend Lace's capabilities
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleAddServer}>
              Add Server
            </button>
          </div>
        )}
      </div>

      <AddMCPServerModal
        isOpen={showAddModal}
        onClose={handleCloseAddModal}
        onAddServer={handleCreateServer}
        loading={addingServer}
      />

      {/* Edit Modal */}
      {editingServerId && (
        <AddMCPServerModal
          isOpen={!!editingServerId}
          onClose={handleCloseEditModal}
          onAddServer={handleUpdateServer}
          loading={false}
          initialData={{
            id: editingServerId,
            config: servers[editingServerId],
          }}
          isEditMode={true}
        />
      )}
    </div>
  );
}
