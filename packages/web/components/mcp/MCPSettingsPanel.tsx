// ABOUTME: MCP server configuration panel for project/global settings management
// ABOUTME: Provides comprehensive server management with tool policies and status monitoring

'use client';

import React, { useState } from 'react';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { MCPServerCard, type ServerStatus, type ToolPolicy } from './MCPServerCard';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faServer, faPlus, faInfoCircle } from '@/lib/fontawesome';
import type { MCPServerConfig } from '@/types/core';

interface MCPSettingsPanelProps {
  title: string;
  description: string;
  servers: Record<string, MCPServerConfig>;
  globalServers?: Record<string, MCPServerConfig>;
  serverStatuses?: Record<string, ServerStatus>;
  onAddServer?: () => void;
  onStartServer?: (serverId: string) => void;
  onStopServer?: (serverId: string) => void;
  onEditServer?: (serverId: string) => void;
  onDeleteServer?: (serverId: string) => void;
  onToolPolicyChange?: (serverId: string, toolName: string, policy: ToolPolicy) => void;
  isProjectLevel?: boolean;
}

export function MCPSettingsPanel({
  title,
  description,
  servers,
  globalServers = {},
  serverStatuses = {},
  onAddServer,
  onStartServer,
  onStopServer,
  onEditServer,
  onDeleteServer,
  onToolPolicyChange,
  isProjectLevel = false,
}: MCPSettingsPanelProps) {
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());

  const toggleServerExpanded = (serverId: string) => {
    const newExpanded = new Set(expandedServers);
    if (newExpanded.has(serverId)) {
      newExpanded.delete(serverId);
    } else {
      newExpanded.add(serverId);
    }
    setExpandedServers(newExpanded);
  };

  const getServerStatus = (serverId: string): ServerStatus => {
    return serverStatuses[serverId] || 'stopped';
  };

  const hasGlobalServers = Object.keys(globalServers).length > 0;
  const hasProjectServers = Object.keys(servers).length > 0;

  return (
    <SettingsPanel title={title}>
      <div className="space-y-6">
        {/* Intro card */}
        <div className="rounded-xl p-5 bg-base-100/60 backdrop-blur-sm border border-base-300/60 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-accent">
              <FontAwesomeIcon icon={faServer} className="w-5 h-5" />
            </div>
            <div className="text-sm">
              <div className="font-medium text-accent mb-1">MCP Server Configuration</div>
              <div className="text-base-content/75 leading-relaxed">{description}</div>
            </div>
          </div>
        </div>

        {/* Add Server Button */}
        <div className="flex justify-end">
          <button className="btn btn-primary btn-sm" onClick={onAddServer}>
            <FontAwesomeIcon icon={faPlus} className="w-4 h-4 mr-2" />
            Add {isProjectLevel ? 'Project ' : ''}Server
          </button>
        </div>

        {/* Server Lists */}
        <div className="space-y-8">
          {/* Global Servers (for project level) */}
          {isProjectLevel && hasGlobalServers && (
            <div className="rounded-xl p-5 bg-base-100/60 backdrop-blur-sm border border-base-300/60 shadow-sm">
              <h3 className="text-lg font-semibold mb-4 text-base-content/80 flex items-center gap-2">
                <FontAwesomeIcon icon={faInfoCircle} className="w-4 h-4" />
                Global Servers (inherited)
              </h3>
              <div className="space-y-4">
                {Object.entries(globalServers).map(([serverId, serverConfig]) => (
                  <MCPServerCard
                    key={serverId}
                    serverId={serverId}
                    config={serverConfig}
                    status={getServerStatus(serverId)}
                    isProjectSpecific={false}
                    onStart={onStartServer}
                    onStop={onStopServer}
                    onEdit={onEditServer}
                    onToolPolicyChange={onToolPolicyChange}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Project/Local Servers */}
          {hasProjectServers && (
            <div className="rounded-xl p-5 bg-base-100/60 backdrop-blur-sm border border-base-300/60 shadow-sm">
              <h3 className="text-lg font-semibold mb-4 text-primary flex items-center gap-2">
                <FontAwesomeIcon icon={faServer} className="w-4 h-4" />
                {isProjectLevel ? 'Project-Specific Servers' : 'MCP Servers'}
              </h3>
              <div className="space-y-4">
                {Object.entries(servers).map(([serverId, serverConfig]) => (
                  <MCPServerCard
                    key={serverId}
                    serverId={serverId}
                    config={serverConfig}
                    status={getServerStatus(serverId)}
                    isProjectSpecific={isProjectLevel}
                    onStart={onStartServer}
                    onStop={onStopServer}
                    onEdit={onEditServer}
                    onDelete={onDeleteServer}
                    onToolPolicyChange={onToolPolicyChange}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {!hasProjectServers && (!isProjectLevel || !hasGlobalServers) && (
            <div className="rounded-xl p-8 bg-base-100/60 backdrop-blur-sm border border-base-300/60 shadow-sm text-center">
              <div className="text-base-content/60 mb-4">
                <FontAwesomeIcon icon={faServer} className="w-12 h-12 mx-auto mb-3" />
                <div className="font-medium">No MCP servers configured</div>
                <div className="text-sm mt-1">
                  {isProjectLevel
                    ? 'Add project-specific MCP servers or configure global servers'
                    : "Add your first MCP server to extend Lace's capabilities"}
                </div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={onAddServer}>
                <FontAwesomeIcon icon={faPlus} className="w-4 h-4 mr-2" />
                Add Server
              </button>
            </div>
          )}
        </div>
      </div>
    </SettingsPanel>
  );
}
