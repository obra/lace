// ABOUTME: Multi-stage toggle component for tool access policies with context-aware options
// ABOUTME: Provides visual radio button UI for better UX than dropdowns with all MCP approval levels

'use client';

import React, { memo } from 'react';

export type ToolPolicy =
  | 'allow'
  | 'require-approval'
  | 'deny'
  | 'disable'
  | 'allow-session'
  | 'allow-project'
  | 'allow-always';

interface ToolPolicyToggleProps {
  value: ToolPolicy;
  onChange: (policy: ToolPolicy) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  context?: 'global' | 'project' | 'session';
}

const CONTEXT_POLICIES: Record<string, ToolPolicy[]> = {
  global: ['allow-always', 'allow-project', 'allow-session', 'require-approval', 'deny', 'disable'],
  project: ['allow-project', 'allow-session', 'require-approval', 'deny', 'disable'],
  session: ['allow-session', 'require-approval', 'deny', 'disable'],
};

const POLICY_CONFIG = {
  'allow-always': {
    label: 'Always',
    description: 'Execute without any restrictions',
    selectedStyle: 'bg-green-950 text-base-content ring-base-300',
    hoverStyle: 'hover:bg-green-950/30',
  },
  'allow-project': {
    label: 'Project',
    description: 'Allow for this project only',
    selectedStyle: 'bg-green-800 text-base-content ring-base-300',
    hoverStyle: 'hover:bg-green-800/30',
  },
  'allow-session': {
    label: 'Session',
    description: 'Allow for this session only',
    selectedStyle: 'bg-green-700 text-base-content ring-base-300',
    hoverStyle: 'hover:bg-green-700/30',
  },
  allow: {
    label: 'Allow',
    description: 'Execute automatically (legacy)',
    selectedStyle: 'bg-green-950 text-base-content ring-base-300',
    hoverStyle: 'hover:bg-green-950/30',
  },
  'require-approval': {
    label: 'Ask',
    description: 'Require user approval',
    selectedStyle: 'bg-yellow-950 text-base-content ring-base-300',
    hoverStyle: 'hover:bg-yellow-950/30',
  },
  deny: {
    label: 'Deny',
    description: 'Block execution',
    selectedStyle: 'bg-red-950 text-base-content ring-base-300',
    hoverStyle: 'hover:bg-red-950/30',
  },
  disable: {
    label: 'Disabled',
    description: 'Tool not available',
    selectedStyle: 'bg-base-600 text-base-content ring-base-300',
    hoverStyle: 'hover:bg-base-600/30',
  },
} as const;

const SIZE_CONFIG = {
  sm: {
    container: 'text-xs',
    button: 'px-3 py-1.5 min-h-7',
  },
  md: {
    container: 'text-sm',
    button: 'px-4 py-2 min-h-9',
  },
  lg: {
    container: 'text-base',
    button: 'px-5 py-2.5 min-h-11',
  },
} as const;

export const ToolPolicyToggle = memo(function ToolPolicyToggle({
  value,
  onChange,
  disabled = false,
  size = 'sm',
  context = 'session',
}: ToolPolicyToggleProps) {
  const sizeConfig = SIZE_CONFIG[size];

  // Filter policies based on context
  const availablePolicies = CONTEXT_POLICIES[context] || CONTEXT_POLICIES.session;

  return (
    <div className={`inline-flex rounded-md bg-base-200 p-0.5 ${sizeConfig.container}`}>
      {availablePolicies.map((policy) => {
        const config = POLICY_CONFIG[policy];
        const isSelected = value === policy;

        return (
          <button
            key={policy}
            type="button"
            onClick={() => onChange(policy)}
            disabled={disabled}
            title={config.description}
            className={`
              ${sizeConfig.button}
              relative font-medium transition-all duration-200 ease-out rounded-sm
              ${
                isSelected
                  ? `${config.selectedStyle} shadow-sm ring-1`
                  : `text-base-content/70 hover:text-base-content ${config.hoverStyle}`
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-1 focus:ring-offset-base-200
            `}
          >
            {config.label}
          </button>
        );
      })}
    </div>
  );
});
