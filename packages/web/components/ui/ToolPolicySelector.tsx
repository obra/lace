// ABOUTME: Dropdown selector for comprehensive tool access policies including all MCP approval levels
// ABOUTME: Reusable component for tool policy management across different contexts

'use client';

import React from 'react';
import type { ToolPolicy } from './ToolPolicyToggle';

interface ToolPolicySelectorProps {
  value: ToolPolicy;
  onChange: (policy: ToolPolicy) => void;
  disabled?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  context?: 'global' | 'project' | 'session';
}

const ALL_POLICY_OPTIONS: Array<{
  value: ToolPolicy;
  label: string;
  description: string;
  contexts: string[];
}> = [
  {
    value: 'allow-always',
    label: 'Allow Always',
    description: 'Execute without any restrictions (global only)',
    contexts: ['global'],
  },
  {
    value: 'allow-project',
    label: 'Allow Project',
    description: 'Allow for this project only',
    contexts: ['global', 'project'],
  },
  {
    value: 'allow-session',
    label: 'Allow Session',
    description: 'Allow for this session only',
    contexts: ['global', 'project', 'session'],
  },
  {
    value: 'allow-once',
    label: 'Allow Once',
    description: 'Allow once then ask again',
    contexts: ['global', 'project', 'session'],
  },
  {
    value: 'allow',
    label: 'Allow',
    description: 'Allow execution (legacy)',
    contexts: ['global', 'project', 'session'],
  },
  {
    value: 'require-approval',
    label: 'Ask',
    description: 'Require user approval each time',
    contexts: ['global', 'project', 'session'],
  },
  {
    value: 'deny',
    label: 'Deny',
    description: 'Block execution',
    contexts: ['global', 'project', 'session'],
  },
  {
    value: 'disable',
    label: 'Disabled',
    description: 'Tool not available',
    contexts: ['global', 'project', 'session'],
  },
];

export function ToolPolicySelector({
  value,
  onChange,
  disabled = false,
  size = 'sm',
  className = '',
  context = 'session',
}: ToolPolicySelectorProps) {
  const sizeClass = {
    xs: 'select-xs',
    sm: 'select-sm',
    md: 'select-md',
    lg: 'select-lg',
  }[size];

  // Filter options based on context
  const availableOptions = ALL_POLICY_OPTIONS.filter((option) => option.contexts.includes(context));

  return (
    <select
      className={`select select-bordered ${sizeClass} ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value as ToolPolicy)}
      disabled={disabled}
    >
      {availableOptions.map((option) => (
        <option key={option.value} value={option.value} title={option.description}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
