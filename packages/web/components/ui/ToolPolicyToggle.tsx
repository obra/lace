// ABOUTME: Multi-stage toggle component for tool access policies
// ABOUTME: Provides a visual range selector style UI instead of dropdowns for better UX

'use client';

import React, { memo } from 'react';

export type ToolPolicy =
  | 'allow'
  | 'require-approval'
  | 'deny'
  | 'disable'
  | 'allow-once'
  | 'allow-session'
  | 'allow-project'
  | 'allow-always';

interface ToolPolicyToggleProps {
  value: ToolPolicy;
  onChange: (policy: ToolPolicy) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const POLICY_CONFIG = {
  allow: {
    label: 'Allow',
    description: 'Execute automatically',
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
    label: 'Block',
    description: 'Never allow',
    selectedStyle: 'bg-red-950 text-base-content ring-base-300',
    hoverStyle: 'hover:bg-red-950/30',
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
}: ToolPolicyToggleProps) {
  const sizeConfig = SIZE_CONFIG[size];

  return (
    <div className={`inline-flex rounded-md bg-base-200 p-0.5 ${sizeConfig.container}`}>
      {(Object.keys(POLICY_CONFIG) as ToolPolicy[]).map((policy) => {
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
