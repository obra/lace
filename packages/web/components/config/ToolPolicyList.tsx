// ABOUTME: Clean tool policy list using explicit backend-resolved policy information
// ABOUTME: No prop drilling - all policy logic resolved server-side with allowedValues arrays

'use client';

import React from 'react';
import { ToolPolicyToggle } from '@/components/ui/ToolPolicyToggle';
import type { ToolPolicy } from '@/types/core';

// Clean API structure with explicit policy information
interface ToolPolicyInfo {
  value: ToolPolicy;
  allowedValues: ToolPolicy[];
  projectValue?: ToolPolicy;
  globalValue?: ToolPolicy;
}

interface ToolPolicyListProps {
  toolPolicyData?: Record<string, ToolPolicyInfo>;
  onChange: (tool: string, policy: ToolPolicy) => void;
  loading?: boolean;
  error?: string | null;
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
  toolPolicyData = {},
  onChange,
  loading = false,
  error = null,
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

  const toolList = Object.keys(toolPolicyData);
  if (toolList.length === 0) {
    return (
      <div className="text-center py-8 text-base-content/60">
        No user-configurable tools available
      </div>
    );
  }

  const { coreTools, mcpTools } = groupToolsBySource(toolList);

  return (
    <div className="space-y-6">
      {/* Core Tools */}
      {coreTools.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-3 text-base-content/80">Core Tools</h4>
          <div className="space-y-2">
            {coreTools.map((tool) => {
              const toolInfo = toolPolicyData[tool];
              return (
                <div
                  key={tool}
                  className="flex items-center justify-between p-3 border border-base-300 rounded-lg"
                >
                  <div>
                    <span className="font-medium text-sm font-mono">{tool}</span>
                    {toolInfo.projectValue && (
                      <div className="text-xs text-base-content/60">
                        Project: {toolInfo.projectValue}
                      </div>
                    )}
                    {toolInfo.globalValue && (
                      <div className="text-xs text-base-content/60">
                        Global: {toolInfo.globalValue}
                      </div>
                    )}
                  </div>
                  <ToolPolicyToggle
                    value={toolInfo.value}
                    allowedValues={toolInfo.allowedValues}
                    onChange={(policy) => onChange(tool, policy)}
                    size="sm"
                  />
                </div>
              );
            })}
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
              const toolInfo = toolPolicyData[fullToolName];

              return (
                <div
                  key={fullToolName}
                  className="flex items-center justify-between p-3 border border-base-300 rounded-lg"
                >
                  <div>
                    <span className="font-medium text-sm font-mono">{toolName}</span>
                    {toolInfo.projectValue && (
                      <div className="text-xs text-base-content/60">
                        Project: {toolInfo.projectValue}
                      </div>
                    )}
                    {toolInfo.globalValue && (
                      <div className="text-xs text-base-content/60">
                        Global: {toolInfo.globalValue}
                      </div>
                    )}
                  </div>
                  <ToolPolicyToggle
                    value={toolInfo.value}
                    allowedValues={toolInfo.allowedValues}
                    onChange={(policy) => onChange(fullToolName, policy)}
                    size="sm"
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
