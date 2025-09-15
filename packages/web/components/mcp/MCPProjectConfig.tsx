// ABOUTME: Inline MCP server configuration for project settings without modal conflicts
// ABOUTME: Simplified version for embedding within existing modals like ProjectEditModal

'use client';

import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faServer } from '@/lib/fontawesome';
import { api } from '@/lib/api-client';
import type { MCPServerConfig } from '@/types/core';
import { MCPServerCard } from './MCPServerCard';

interface MCPProjectConfigProps {
  projectId: string;
  onOpenAddModal?: () => void; // Let parent handle modals
}

interface ProjectMCPServersResponse {
  projectId: string;
  servers: Array<MCPServerConfig & { id: string }>;
}

interface GlobalMCPServersResponse {
  servers: Array<MCPServerConfig & { id: string }>;
}

export function MCPProjectConfig({ projectId, onOpenAddModal }: MCPProjectConfigProps) {
  const [projectServers, setProjectServers] = useState<Record<string, MCPServerConfig>>({});
  const [globalServers, setGlobalServers] = useState<Record<string, MCPServerConfig>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load project and global MCP configuration
  useEffect(() => {
    const loadConfiguration = async () => {
      try {
        // Load global servers
        const globalData = await api.get<GlobalMCPServersResponse>('/api/mcp/servers');
        const globalRecord: Record<string, MCPServerConfig> = {};
        globalData.servers.forEach((server) => {
          const { id, ...config } = server;
          globalRecord[id] = config;
        });

        // The project API returns ALL servers (global + project merged)
        // We need to separate project-specific servers from global ones
        const projectData = await api.get<ProjectMCPServersResponse>(
          `/api/projects/${projectId}/mcp/servers`
        );

        // Project-specific servers are those NOT in global config
        const projectRecord: Record<string, MCPServerConfig> = {};
        projectData.servers.forEach((server) => {
          const { id, ...config } = server;
          // Only include if it's NOT a global server
          if (!globalRecord[id]) {
            projectRecord[id] = config;
          }
        });

        setGlobalServers(globalRecord);
        setProjectServers(projectRecord);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load MCP configuration');
      } finally {
        setLoading(false);
      }
    };

    void loadConfiguration();
  }, [projectId]);

  const handleDeleteProjectServer = async (serverId: string) => {
    try {
      await api.delete(`/api/projects/${projectId}/mcp/servers/${serverId}`);
      setProjectServers((prev) => {
        const updated = { ...prev };
        delete updated[serverId];
        return updated;
      });
    } catch (error) {
      // Error handling
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center p-4">
        <div className="loading loading-spinner loading-md"></div>
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

  const hasGlobalServers = Object.keys(globalServers).length > 0;
  const hasProjectServers = Object.keys(projectServers).length > 0;

  return (
    <div className="space-y-4">
      {/* Add Server Button */}
      <div className="flex justify-end">
        <button
          className="btn btn-primary btn-sm"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            console.warn('[MCP Debug] Add Project Server button clicked');
            onOpenAddModal?.();
          }}
        >
          <FontAwesomeIcon icon={faPlus} className="w-4 h-4 mr-2" />
          Add Project Server
        </button>
      </div>

      {/* Global Servers (inherited) */}
      {hasGlobalServers && (
        <div>
          <h4 className="text-sm font-medium text-base-content/80 mb-2">
            Global Servers (inherited)
          </h4>
          <div className="space-y-3">
            {Object.entries(globalServers).map(([serverId, config]) => (
              <MCPServerCard
                key={serverId}
                serverId={serverId}
                config={config}
                isGlobal={true}
                showActions={false}
              />
            ))}
          </div>
        </div>
      )}

      {/* Project-Specific Servers */}
      {hasProjectServers && (
        <div>
          <h4 className="text-sm font-medium text-primary mb-2">Project-Specific Servers</h4>
          <div className="space-y-3">
            {Object.entries(projectServers).map(([serverId, config]) => (
              <MCPServerCard
                key={serverId}
                serverId={serverId}
                config={config}
                isGlobal={false}
                showActions={true}
                onEdit={() => {
                  /* TODO: Edit functionality */
                }}
                onDelete={() => handleDeleteProjectServer(serverId)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!hasProjectServers && !hasGlobalServers && (
        <div className="text-center text-base-content/60 py-6">
          <FontAwesomeIcon icon={faServer} className="w-8 h-8 mx-auto mb-3" />
          <div className="text-sm font-medium mb-1">No MCP servers configured</div>
          <div className="text-xs mb-3">
            Configure global servers or add project-specific servers
          </div>
          <button className="btn btn-primary btn-sm" onClick={onOpenAddModal}>
            <FontAwesomeIcon icon={faPlus} className="w-4 h-4 mr-1" />
            Add Server
          </button>
        </div>
      )}
    </div>
  );
}
