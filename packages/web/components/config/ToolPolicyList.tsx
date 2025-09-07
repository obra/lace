// ABOUTME: Shared component for displaying tool access policy configuration
// ABOUTME: Eliminates duplication across project and session configuration modals

'use client';

import React from 'react';
import { ToolPolicyToggle } from '@/components/ui/ToolPolicyToggle';
import type { ToolPolicy } from '@/components/ui/ToolPolicyToggle';

interface ToolPolicyListProps {
  tools: string[];
  policies: Record<string, ToolPolicy>;
  onChange: (tool: string, policy: ToolPolicy) => void;
  loading?: boolean;
  error?: string | null;
  context?: 'global' | 'project' | 'session';
}

// Helper function to group tools by source
const groupToolsBySource = (tools: string[]) => {
  const coreTools: string[] = [];
  const mcpTools: Record<string, string[]> = {};

  tools.forEach((tool) => {
    if (tool.includes('/')) {
      // MCP tool (format: serverId/toolName)
      const [serverId, toolName] = tool.split('/', 2);
      if (!mcpTools[serverId]) {
        mcpTools[serverId] = [];
      }
      mcpTools[serverId].push(toolName);
    } else {
      // Core tool
      coreTools.push(tool);
    }
  });

  return { coreTools, mcpTools };
};

export function ToolPolicyList({
  tools,
  policies,
  onChange,
  loading = false,
  error = null,
  context = 'session',
}: ToolPolicyListProps) {
  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-error font-medium mb-2">Failed to load tools</div>
        <div className="text-sm text-base-content/60">{error}</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="flex items-center gap-3">
          <div className="loading loading-spinner loading-md"></div>
          <span>Loading tools...</span>
        </div>
      </div>
    );
  }

  if (tools.length === 0) {
    return (
      <div className="text-center py-8 text-base-content/60">
        No user-configurable tools available
      </div>
    );
  }

  const { coreTools, mcpTools } = groupToolsBySource(tools);

  return (
    <div className="space-y-6">
      {/* Core Tools */}
      {coreTools.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-3 text-base-content/80">Core Tools</h4>
          <div className="space-y-2">
            {coreTools.map((tool) => (
              <div
                key={tool}
                className="flex items-center justify-between p-3 border border-base-300 rounded-lg"
              >
                <span className="font-medium text-sm font-mono">{tool}</span>
                <ToolPolicyToggle
                  value={(policies[tool] || 'ask') as ToolPolicy}
                  onChange={(policy) => onChange(tool, policy)}
                  size="sm"
                  context={context}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MCP Tools by Server */}
      {Object.entries(mcpTools).map(([serverId, serverTools]) => (
        <div key={serverId}>
          <h4 className="text-sm font-semibold mb-3 text-primary">{serverId} MCP Tools</h4>
          <div className="space-y-2">
            {serverTools.map((toolName) => {
              const fullToolName = `${serverId}/${toolName}`;
              return (
                <div
                  key={fullToolName}
                  className="flex items-center justify-between p-3 border border-base-300 rounded-lg"
                >
                  <span className="font-medium text-sm font-mono">{toolName}</span>
                  <ToolPolicyToggle
                    value={(policies[fullToolName] || 'ask') as ToolPolicy}
                    onChange={(policy) => onChange(fullToolName, policy)}
                    size="sm"
                    context={context}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
