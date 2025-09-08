// ABOUTME: Dropdown selector for comprehensive tool access policies including all MCP approval levels
// ABOUTME: Reusable component for tool policy management across different contexts

'use client';

import React from 'react';
import type { ToolPolicy } from '@/types/core';

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
    value: 'allow',
    label: 'Allow',
    description: 'Auto-approve without prompting',
    contexts: ['global', 'project', 'session'],
  },
  {
    value: 'ask',
    label: 'Ask',
    description: 'Prompt user each time',
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
    label: 'Disable',
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
