// ABOUTME: Session sidebar showing active MCP tools with status indicators
// ABOUTME: Provides real-time view of available tools grouped by server during conversations

'use client';

import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTools, faCog, faChevronDown, faChevronRight } from '@/lib/fontawesome';
import type { MCPServerConfig } from '@/types/core';

export type ToolStatus = 'active' | 'pending' | 'disabled' | 'denied';

interface ToolInfo {
  name: string;
  description?: string;
  status: ToolStatus;
  serverName: string;
}

interface ServerGroup {
  id: string;
  name: string;
  icon: string;
  tools: ToolInfo[];
  activeCount: number;
  totalCount: number;
}

interface MCPToolsSidebarProps {
  servers: Record<string, MCPServerConfig>;
  toolUsageStats?: Record<string, number>;
  onConfigureTools?: () => void;
  className?: string;
}

const getToolStatusConfig = (status: ToolStatus) => {
  switch (status) {
    case 'active':
      return { icon: '✓', color: 'text-success', label: 'active' };
    case 'pending':
      return { icon: '⚠', color: 'text-warning', label: 'pending approval' };
    case 'disabled':
      return { icon: '✗', color: 'text-base-content/60', label: 'disabled' };
    case 'denied':
      return { icon: '✗', color: 'text-error', label: 'denied' };
  }
};

const mapPolicyToStatus = (policy: string): ToolStatus => {
  switch (policy) {
    case 'allow-always':
    case 'allow-project':
    case 'allow-session':
    case 'allow-once':
      return 'active';
    case 'require-approval':
      return 'pending';
    case 'deny':
      return 'denied';
    case 'disable':
    default:
      return 'disabled';
  }
};

const getServerIcon = (serverId: string): string => {
  if (serverId.includes('filesystem') || serverId.includes('file')) return '📁';
  if (serverId.includes('git')) return '🔄';
  if (serverId.includes('search') || serverId.includes('web')) return '🔍';
  if (serverId.includes('database') || serverId.includes('sql')) return '💾';
  if (serverId.includes('doc') || serverId.includes('markdown')) return '📄';
  return '🔧';
};

export function MCPToolsSidebar({
  servers,
  toolUsageStats = {},
  onConfigureTools,
  className = '',
}: MCPToolsSidebarProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Transform servers into tool groups
  const serverGroups: ServerGroup[] = Object.entries(servers)
    .filter(([_, config]) => config.enabled)
    .map(([serverId, config]) => {
      const tools: ToolInfo[] = [];

      // Use discovered tools if available, otherwise fall back to configured tools
      if (config.discoveredTools && config.discoveryStatus === 'success') {
        config.discoveredTools.forEach((tool) => {
          const policy = config.tools[tool.name] || 'require-approval';
          tools.push({
            name: tool.name,
            description: tool.description,
            status: mapPolicyToStatus(policy),
            serverName: serverId,
          });
        });
      } else {
        Object.entries(config.tools).forEach(([toolName, policy]) => {
          tools.push({
            name: toolName,
            description: undefined,
            status: mapPolicyToStatus(policy),
            serverName: serverId,
          });
        });
      }

      const activeCount = tools.filter((tool) => tool.status === 'active').length;

      return {
        id: serverId,
        name: serverId,
        icon: getServerIcon(serverId),
        tools,
        activeCount,
        totalCount: tools.length,
      };
    })
    .filter((group) => group.totalCount > 0);

  const toggleGroupExpanded = (groupId: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
    } else {
      newExpanded.add(groupId);
    }
    setExpandedGroups(newExpanded);
  };

  const totalActiveTools = serverGroups.reduce((sum, group) => sum + group.activeCount, 0);

  return (
    <div className={`w-80 bg-base-100 rounded-lg border border-base-300 p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold flex items-center gap-2">
          <FontAwesomeIcon icon={faTools} className="w-4 h-4" />
          Active MCP Tools
        </h3>
        <button className="btn btn-xs btn-ghost" onClick={onConfigureTools} title="Configure Tools">
          <FontAwesomeIcon icon={faCog} className="w-3 h-3" />
        </button>
      </div>

      {/* Tools Summary */}
      {totalActiveTools > 0 && (
        <div className="text-xs text-base-content/70 mb-3">
          {totalActiveTools} tools ready across {serverGroups.length} servers
        </div>
      )}

      {/* Server Groups */}
      <div className="space-y-2">
        {serverGroups.map((group) => {
          const isExpanded = expandedGroups.has(group.id);

          return (
            <div key={group.id} className="border border-base-300 rounded-lg">
              {/* Group Header */}
              <button
                className="w-full p-3 text-left hover:bg-base-200/50 transition-colors rounded-lg"
                onClick={() => toggleGroupExpanded(group.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FontAwesomeIcon
                      icon={isExpanded ? faChevronDown : faChevronRight}
                      className="w-3 h-3"
                    />
                    <span>{group.icon}</span>
                    <span>{group.name}</span>
                    <span className="text-xs text-base-content/60">
                      ({group.activeCount}/{group.totalCount} active)
                    </span>
                  </div>
                </div>
              </button>

              {/* Group Content */}
              {isExpanded && (
                <div className="p-3 pt-0">
                  <div className="space-y-1 text-sm">
                    {group.tools.map((tool) => {
                      const statusConfig = getToolStatusConfig(tool.status);

                      return (
                        <div key={tool.name} className="flex items-center gap-2 py-1">
                          <span className={`${statusConfig.color} w-4`}>{statusConfig.icon}</span>
                          <span className="flex-1">{tool.name}</span>
                          <span className={`text-xs ${statusConfig.color}`}>
                            {statusConfig.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {serverGroups.length === 0 && (
        <div className="text-center text-base-content/60 py-8">
          <FontAwesomeIcon icon={faTools} className="w-8 h-8 mx-auto mb-3" />
          <div className="text-sm font-medium mb-1">No active tools</div>
          <div className="text-xs">Configure MCP servers to enable tools</div>
          {onConfigureTools && (
            <button className="btn btn-xs btn-outline mt-3" onClick={onConfigureTools}>
              Configure Tools
            </button>
          )}
        </div>
      )}

      {/* Configure Link */}
      {serverGroups.length > 0 && onConfigureTools && (
        <div className="pt-3 mt-3 border-t border-base-300">
          <button className="btn btn-xs btn-outline w-full" onClick={onConfigureTools}>
            <FontAwesomeIcon icon={faCog} className="w-3 h-3 mr-1" />
            Configure MCP
          </button>
        </div>
      )}
    </div>
  );
}
