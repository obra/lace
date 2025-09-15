// ABOUTME: Shared MCP server display component for consistent presentation across the app
// ABOUTME: Shows server info with tools as comma-separated list, not individual selectors

'use client';

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEdit, faTrash } from '@/lib/fontawesome';
import type { MCPServerConfig } from '@/types/core';

interface MCPServerCardProps {
  serverId: string;
  config: MCPServerConfig;
  isGlobal?: boolean;
  showActions?: boolean;
  onEdit?: (serverId: string) => void;
  onDelete?: (serverId: string) => void;
  className?: string;
}

export function MCPServerCard({
  serverId,
  config,
  isGlobal = false,
  showActions = true,
  onEdit,
  onDelete,
  className = '',
}: MCPServerCardProps) {
  const baseClasses = isGlobal
    ? 'border-l-4 border-base-300 pl-4 py-3 bg-base-50 rounded-lg'
    : 'border-l-4 border-primary pl-4 py-3 rounded-lg';

  return (
    <div className={`${baseClasses} ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 bg-base-400 rounded-full"></span>
          <span className="font-semibold">{serverId}</span>
          {!isGlobal && <span className="badge badge-primary badge-xs">project only</span>}
          <code className="bg-base-200 px-2 py-1 rounded text-xs">
            {config.command} {config.args?.join(' ')}
          </code>
          {config.discoveryStatus === 'discovering' && (
            <span className="loading loading-spinner loading-xs"></span>
          )}
        </div>
        {showActions && (
          <div className="flex gap-1">
            {onEdit && (
              <button
                className="btn btn-xs btn-outline"
                onClick={() => onEdit(serverId)}
                title="Edit Server"
              >
                <FontAwesomeIcon icon={faEdit} className="w-3 h-3" />
              </button>
            )}
            {onDelete && (
              <button
                className="btn btn-xs btn-outline btn-error"
                onClick={() => onDelete(serverId)}
                title="Delete Server"
              >
                <FontAwesomeIcon icon={faTrash} className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Discovery Status */}
      {config.discoveryStatus === 'failed' && (
        <div className="text-xs text-error mb-2 ml-5">
          Discovery failed: MCP error -{config.discoveryError}: Connection closed
        </div>
      )}

      {/* Tool list as comma-separated string */}
      {config.discoveredTools && config.discoveredTools.length > 0 && (
        <div className="ml-5 text-xs text-base-content/60">
          Tools: {config.discoveredTools.map((tool) => tool.name).join(', ')}
        </div>
      )}
    </div>
  );
}
