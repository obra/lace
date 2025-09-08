// ABOUTME: Multi-stage toggle component for tool access policies with explicit allowed values
// ABOUTME: Clean implementation using allowedValues array from backend with legacy fallback

'use client';

import React, { memo } from 'react';

export type ToolPolicy = 'allow' | 'ask' | 'deny' | 'disable';

interface ToolPolicyToggleProps {
  value: ToolPolicy;
  onChange: (policy: ToolPolicy) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  allowedValues?: ToolPolicy[]; // Explicit array from backend (preferred)
  // Legacy support
  context?: 'global' | 'project' | 'session';
  parentPolicy?: ToolPolicy;
}

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
  allowedValues,
  context = 'session',
  parentPolicy,
}: ToolPolicyToggleProps) {
  const sizeConfig = SIZE_CONFIG[size];
  const allPolicies: ToolPolicy[] = ['allow', 'ask', 'deny', 'disable'];

  return (
    <div className={`inline-flex rounded-md bg-base-200 p-0.5 ${sizeConfig.container}`}>
      {allPolicies.map((policy) => {
        const config = POLICY_CONFIG[policy];
        const isSelected = value === policy;

        // Clean approach: check if policy is in allowedValues array
        const isNotAllowed = allowedValues ? !allowedValues.includes(policy) : false;

        // Legacy fallback: compute from parent policy if no allowedValues provided
        let isLegacyDisabled = false;
        if (!allowedValues && parentPolicy && context !== 'global') {
          const restrictionOrder: ToolPolicy[] = ['allow', 'ask', 'deny', 'disable'];
          const parentIndex = restrictionOrder.indexOf(parentPolicy);
          const optionIndex = restrictionOrder.indexOf(policy);
          isLegacyDisabled = optionIndex < parentIndex && policy !== 'disable';
        }

        const isOptionDisabled = isNotAllowed || isLegacyDisabled;

        return (
          <button
            key={policy}
            type="button"
            onClick={() => !isOptionDisabled && onChange(policy)}
            disabled={disabled || isOptionDisabled}
            title={
              isOptionDisabled
                ? 'Not available - restricted by policy hierarchy'
                : config.description
            }
            className={`
              ${sizeConfig.button}
              relative font-medium transition-all duration-200 ease-out rounded-sm
              ${
                isSelected
                  ? `${config.selectedStyle} shadow-sm ring-1`
                  : isOptionDisabled
                    ? 'text-base-content/30 bg-base-200 cursor-not-allowed'
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
