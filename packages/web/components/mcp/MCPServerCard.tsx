// ABOUTME: MCP server configuration card component with tool policy management
// ABOUTME: Displays server status, command, discovered tools, and tool policy controls

'use client';

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlay, faStop, faEdit, faTrash } from '@/lib/fontawesome';
import type { MCPServerConfig, DiscoveredTool } from '@/types/core';

export type ServerStatus = 'running' | 'stopped' | 'failed' | 'discovering';
export type ToolPolicy =
  | 'disable'
  | 'deny'
  | 'ask'
  | 'allow-once'
  | 'allow-session'
  | 'allow-project'
  | 'allow-always';

interface MCPServerCardProps {
  serverId: string;
  config: MCPServerConfig;
  status: ServerStatus;
  isProjectSpecific?: boolean;
  onStart?: (serverId: string) => void;
  onStop?: (serverId: string) => void;
  onEdit?: (serverId: string) => void;
  onDelete?: (serverId: string) => void;
  onToolPolicyChange?: (serverId: string, toolName: string, policy: ToolPolicy) => void;
}

const statusConfig = {
  running: {
    dot: 'w-2 h-2 bg-success rounded-full',
    border: 'border-l-4 border-success',
    action: { label: 'Stop', icon: faStop, variant: 'btn-warning' as const },
  },
  stopped: {
    dot: 'w-2 h-2 bg-base-300 rounded-full',
    border: 'border-l-4 border-base-300',
    action: { label: 'Start', icon: faPlay, variant: 'btn-success' as const },
  },
  failed: {
    dot: 'w-2 h-2 bg-error rounded-full',
    border: 'border-l-4 border-error',
    action: { label: 'Retry', icon: faPlay, variant: 'btn-success' as const },
  },
  discovering: {
    dot: 'w-2 h-2 bg-warning rounded-full animate-pulse',
    border: 'border-l-4 border-warning',
    action: { label: 'Stop', icon: faStop, variant: 'btn-warning' as const },
  },
};

const policyOptions: { value: ToolPolicy; label: string }[] = [
  { value: 'allow-always', label: 'Allow Always' },
  { value: 'allow-project', label: 'Allow Project' },
  { value: 'allow-session', label: 'Allow Session' },
  { value: 'allow-once', label: 'Allow Once' },
  { value: 'ask', label: 'Require Approval' },
  { value: 'deny', label: 'Deny' },
  { value: 'disable', label: 'Disable' },
];

export function MCPServerCard({
  serverId,
  config,
  status,
  isProjectSpecific = false,
  onStart,
  onStop,
  onEdit,
  onDelete,
  onToolPolicyChange,
}: MCPServerCardProps) {
  const statusInfo = statusConfig[status];

  // Get tools from discovery cache or fallback to configured tools
  const tools =
    config.discoveredTools ||
    Object.keys(config.tools).map((name) => ({ name, description: undefined }));

  const handleStatusAction = () => {
    if (status === 'running' || status === 'discovering') {
      onStop?.(serverId);
    } else {
      onStart?.(serverId);
    }
  };

  const hasStatusControl = onStart && onStop;

  const formatCommand = () => {
    const command = config.command;
    const args = config.args?.join(' ') || '';
    return `${command} ${args}`.trim();
  };

  return (
    <div className={`${statusInfo.border} pl-4 space-y-3`}>
      {/* Server Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={statusInfo.dot} />
          <span className="font-semibold">{serverId}</span>
          {isProjectSpecific && <span className="badge badge-primary badge-sm">project only</span>}
          <code className="bg-base-200 px-2 py-1 rounded text-xs">{formatCommand()}</code>
        </div>
        <div className="flex gap-1">
          {hasStatusControl && (
            <button
              className={`btn btn-xs btn-outline ${statusInfo.action.variant}`}
              onClick={handleStatusAction}
              title={statusInfo.action.label}
            >
              <FontAwesomeIcon icon={statusInfo.action.icon} className="w-3 h-3" />
            </button>
          )}
          <button
            className="btn btn-xs btn-outline"
            onClick={() => onEdit?.(serverId)}
            title="Edit Server"
          >
            <FontAwesomeIcon icon={faEdit} className="w-3 h-3" />
          </button>
          <button
            className="btn btn-xs btn-outline btn-error"
            onClick={() => onDelete?.(serverId)}
            title="Delete Server"
          >
            <FontAwesomeIcon icon={faTrash} className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Discovery Status */}
      {config.discoveryStatus && config.discoveryStatus !== 'success' && (
        <div className="ml-5">
          {config.discoveryStatus === 'discovering' && (
            <div className="text-xs text-warning flex items-center gap-2">
              <span className="loading loading-spinner loading-xs"></span>
              Discovering tools...
            </div>
          )}
          {config.discoveryStatus === 'failed' && (
            <div className="text-xs text-error">Discovery failed: {config.discoveryError}</div>
          )}
          {config.discoveryStatus === 'never' && (
            <div className="text-xs text-base-content/60">Tools not yet discovered</div>
          )}
        </div>
      )}

      {/* Tools List */}
      {tools.length > 0 && (
        <div className="ml-5 space-y-1">
          {tools.map((tool, index) => {
            const isLast = index === tools.length - 1;
            const currentPolicy = config.tools[tool.name] || 'ask';

            return (
              <div key={tool.name} className="flex items-center gap-3">
                <select
                  className="select select-xs select-bordered w-auto"
                  value={currentPolicy}
                  onChange={(e) =>
                    onToolPolicyChange?.(serverId, tool.name, e.target.value as ToolPolicy)
                  }
                >
                  {policyOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="font-mono text-sm">
                  {isLast ? '└─' : '├─'} {tool.name}
                </span>
                {tool.description && (
                  <span className="text-xs text-base-content/60" title={tool.description}>
                    ℹ️
                  </span>
                )}
                {isProjectSpecific && <span className="text-xs text-primary">*</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* No Tools State */}
      {tools.length === 0 && (
        <div className="ml-5 text-xs text-base-content/60">No tools discovered yet</div>
      )}
    </div>
  );
}
