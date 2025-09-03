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
}

export function ToolPolicyList({
  tools,
  policies,
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

  if (tools.length === 0) {
    return (
      <div className="text-center py-8 text-base-content/60">
        No user-configurable tools available
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 gap-3">
      {tools.map((tool) => (
        <div
          key={tool}
          className="flex items-center justify-between p-3 border border-base-300 rounded-lg"
        >
          <span className="font-medium text-sm">{tool}</span>
          <ToolPolicyToggle
            value={(policies[tool] || 'require-approval') as ToolPolicy}
            onChange={(policy) => onChange(tool, policy)}
            size="sm"
          />
        </div>
      ))}
    </div>
  );
}
