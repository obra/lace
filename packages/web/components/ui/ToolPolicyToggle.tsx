// ABOUTME: Multi-stage toggle component for tool access policies with context-aware options
// ABOUTME: Provides visual radio button UI for better UX than dropdowns with all MCP approval levels

'use client';

import React, { memo } from 'react';

export type ToolPolicy = 'allow' | 'ask' | 'deny' | 'disable';

interface ToolPolicyToggleProps {
  value: ToolPolicy;
  onChange: (policy: ToolPolicy) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  context?: 'global' | 'project' | 'session';
  parentPolicy?: ToolPolicy; // For progressive restriction
}

// Progressive restriction logic: each level can only be equal or more restrictive than parent
const getAvailablePolicies = (
  parentPolicy?: ToolPolicy,
  context: string = 'session'
): ToolPolicy[] => {
  const allPolicies: ToolPolicy[] = ['allow', 'ask', 'deny', 'disable'];

  if (context === 'global' || !parentPolicy) {
    return allPolicies; // Global level can set any policy
  }

  // Progressive restriction: can only choose equal or more restrictive than parent
  const restrictionOrder: ToolPolicy[] = ['allow', 'ask', 'deny', 'disable'];
  const parentIndex = restrictionOrder.indexOf(parentPolicy);

  // Can choose current parent level or more restrictive + always allow disable as ultimate restriction
  return restrictionOrder.slice(parentIndex).concat(parentIndex === 3 ? [] : ['disable']);
};

const POLICY_CONFIG = {
  allow: {
    label: 'Allow',
    description: 'Auto-approve without prompting',
    selectedStyle: 'bg-green-950 text-base-content ring-base-300',
    hoverStyle: 'hover:bg-green-950/30',
  },
  ask: {
    label: 'Ask',
    description: 'Prompt user each time',
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
    label: 'Disable',
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
  parentPolicy,
}: ToolPolicyToggleProps) {
  const sizeConfig = SIZE_CONFIG[size];

  // Get available policies based on progressive restriction
  const availablePolicies = getAvailablePolicies(parentPolicy, context);

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
