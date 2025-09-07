// ABOUTME: Inline MCP server configuration for project settings without modal conflicts
// ABOUTME: Simplified version for embedding within existing modals like ProjectEditModal

'use client';

import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faServer, faEdit, faTrash } from '@/lib/fontawesome';
import { api } from '@/lib/api-client';
import type { MCPServerConfig } from '@/types/core';
import type { ToolPolicy } from './MCPServerCard';

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

        // Load project-specific servers
        const projectData = await api.get<ProjectMCPServersResponse>(
          `/api/projects/${projectId}/mcp/servers`
        );
        const projectRecord: Record<string, MCPServerConfig> = {};
        projectData.servers.forEach((server) => {
          const { id, ...config } = server;
          projectRecord[id] = config;
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

  const handleToolPolicyChange = async (serverId: string, toolName: string, policy: ToolPolicy) => {
    try {
      // Check if this is a project server or global override
      const isProjectServer = serverId in projectServers;
      const currentConfig = isProjectServer ? projectServers[serverId] : globalServers[serverId];

      const updatedConfig = {
        ...currentConfig,
        tools: {
          ...currentConfig.tools,
          [toolName]: policy,
        },
      };

      if (isProjectServer) {
        await api.put(`/api/projects/${projectId}/mcp/servers/${serverId}`, updatedConfig);
        setProjectServers((prev) => ({ ...prev, [serverId]: updatedConfig }));
      } else {
        // TODO: Handle global server policy override for project
      }
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
        <button className="btn btn-primary btn-sm" onClick={onOpenAddModal}>
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
              <div key={serverId} className="border-l-4 border-base-300 pl-3 py-2 bg-base-50">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{serverId}</span>
                    <code className="bg-base-200 px-2 py-1 rounded text-xs">
                      {config.command} {config.args?.join(' ')}
                    </code>
                  </div>
                </div>

                {/* Tool policies */}
                <div className="ml-2 space-y-1">
                  {config.discoveredTools?.map((tool) => {
                    const currentPolicy = config.tools[tool.name] || 'require-approval';
                    return (
                      <div key={tool.name} className="flex items-center gap-2 text-xs">
                        <select
                          className="select select-xs select-bordered"
                          value={currentPolicy}
                          onChange={(e) =>
                            handleToolPolicyChange(
                              serverId,
                              tool.name,
                              e.target.value as ToolPolicy
                            )
                          }
                        >
                          <option value="allow-always">Allow Always</option>
                          <option value="allow-session">Allow Session</option>
                          <option value="require-approval">Require Approval</option>
                          <option value="deny">Deny</option>
                        </select>
                        <span className="font-mono">{tool.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
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
              <div key={serverId} className="border-l-4 border-primary pl-3 py-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{serverId}</span>
                    <span className="badge badge-primary badge-xs">project only</span>
                    <code className="bg-base-200 px-2 py-1 rounded text-xs">
                      {config.command} {config.args?.join(' ')}
                    </code>
                  </div>
                  <div className="flex gap-1">
                    <button
                      className="btn btn-xs btn-outline"
                      onClick={() => {
                        /* TODO: Edit */
                      }}
                      title="Edit Server"
                    >
                      <FontAwesomeIcon icon={faEdit} className="w-3 h-3" />
                    </button>
                    <button
                      className="btn btn-xs btn-outline btn-error"
                      onClick={() => handleDeleteProjectServer(serverId)}
                      title="Delete Server"
                    >
                      <FontAwesomeIcon icon={faTrash} className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Tool policies */}
                <div className="ml-2 space-y-1">
                  {config.discoveredTools?.map((tool) => {
                    const currentPolicy = config.tools[tool.name] || 'require-approval';
                    return (
                      <div key={tool.name} className="flex items-center gap-2 text-xs">
                        <select
                          className="select select-xs select-bordered"
                          value={currentPolicy}
                          onChange={(e) =>
                            handleToolPolicyChange(
                              serverId,
                              tool.name,
                              e.target.value as ToolPolicy
                            )
                          }
                        >
                          <option value="allow-always">Allow Always</option>
                          <option value="allow-session">Allow Session</option>
                          <option value="require-approval">Require Approval</option>
                          <option value="deny">Deny</option>
                        </select>
                        <span className="font-mono">{tool.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
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
