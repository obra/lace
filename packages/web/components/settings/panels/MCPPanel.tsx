// ABOUTME: MCP configuration panel for global settings with simplified inline implementation
// ABOUTME: Provides global MCP server configuration interface integrated with settings system

'use client';

import React, { useState, useEffect } from 'react';
import { AddMCPServerModal } from '@lace/web/components/modals/AddMCPServerModal';
import { MCPServerCard } from '@lace/web/components/mcp/MCPServerCard';
import { api } from '@lace/web/lib/api-client';
import type { MCPServerConfig } from '@lace/web/types/core';

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
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load MCP servers');
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
      console.error('Add MCP server failed', error);
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
      console.error('Update MCP server failed', error);
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
      console.error('Delete MCP server failed', error);
    }
  };

  // Tool policy management moved to Tools tab

  if (loading) {
    return (
      <div className="flex justify-center items-center p-8" data-testid="loading-state">
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
    <div className="space-y-6" data-testid="mcp-panel">
      {/* Header */}
      <div data-testid="mcp-panel-header">
        <h2 className="text-2xl font-bold mb-2">🌍 Global MCP Settings</h2>
        <p className="text-base-content/70">
          Configure MCP servers available to all projects. These settings apply globally and can be
          overridden at the project level.
        </p>
      </div>

      {/* Add Server Button */}
      <div className="flex justify-end">
        <button
          className="btn btn-primary btn-sm"
          onClick={handleAddServer}
          data-testid="add-server-button"
        >
          Add Server
        </button>
      </div>

      {/* Server List */}
      <div className="space-y-4" data-testid="servers-list">
        {Object.entries(servers).map(([serverId, config]) => (
          <MCPServerCard
            key={serverId}
            serverId={serverId}
            config={config}
            isGlobal={true}
            showActions={true}
            onEdit={handleEditServer}
            onDelete={handleDeleteServer}
          />
        ))}

        {Object.keys(servers).length === 0 && (
          <div className="text-center text-base-content/60 py-8" data-testid="empty-state">
            <div className="text-sm font-medium mb-1">No MCP servers configured</div>
            <div className="text-xs mb-3">
              Add your first MCP server to extend Lace's capabilities
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleAddServer}
              data-testid="empty-state-add-server"
            >
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
