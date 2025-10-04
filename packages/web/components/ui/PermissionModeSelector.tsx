// ABOUTME: Segmented control component for permission mode selection with visual indicators
// ABOUTME: Provides quick switching between normal, yolo, and read-only permission modes

'use client';

import React, { memo } from 'react';
import type { PermissionOverrideMode } from '@lace/core/tools/types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faShield, faRocket, faEye } from '@fortawesome/free-solid-svg-icons';

interface PermissionModeSelectorProps {
  value: PermissionOverrideMode;
  onChange: (mode: PermissionOverrideMode) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const MODE_CONFIG = {
  normal: {
    label: 'Normal',
    icon: faShield,
    description: 'Standard permission controls - asks for approval',
    selectedStyle: 'bg-blue-950 text-base-content ring-blue-400',
    hoverStyle: 'hover:bg-blue-950/30',
    iconColor: 'text-blue-400',
  },
  yolo: {
    label: 'Yolo',
    icon: faRocket,
    description: 'Auto-approve all tools - no prompts',
    selectedStyle: 'bg-amber-950 text-base-content ring-amber-400',
    hoverStyle: 'hover:bg-amber-950/30',
    iconColor: 'text-amber-400',
  },
  'read-only': {
    label: 'Read Only',
    icon: faEye,
    description: 'Only safe read operations allowed',
    selectedStyle: 'bg-green-950 text-base-content ring-green-400',
    hoverStyle: 'hover:bg-green-950/30',
    iconColor: 'text-green-400',
  },
} as const;

const SIZE_CONFIG = {
  sm: {
    container: 'text-xs',
    button: 'px-3 py-1.5 min-h-7',
    icon: 'text-xs',
    spacing: 'gap-1.5',
  },
  md: {
    container: 'text-sm',
    button: 'px-4 py-2 min-h-9',
    icon: 'text-sm',
    spacing: 'gap-2',
  },
  lg: {
    container: 'text-base',
    button: 'px-5 py-2.5 min-h-11',
    icon: 'text-base',
    spacing: 'gap-2.5',
  },
} as const;

export const PermissionModeSelector = memo(function PermissionModeSelector({
  value,
  onChange,
  disabled = false,
  size = 'md',
}: PermissionModeSelectorProps) {
  const sizeConfig = SIZE_CONFIG[size];
  const modes: PermissionOverrideMode[] = ['normal', 'yolo', 'read-only'];

  return (
    <div className={`inline-flex rounded-md bg-base-200 p-0.5 ${sizeConfig.container}`}>
      {modes.map((mode) => {
        const config = MODE_CONFIG[mode];
        const isSelected = value === mode;

        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            disabled={disabled}
            title={config.description}
            className={`
              ${sizeConfig.button}
              relative font-medium transition-all duration-200 ease-out rounded-sm
              flex items-center ${sizeConfig.spacing}
              ${
                isSelected
                  ? `${config.selectedStyle} shadow-sm ring-1`
                  : `text-base-content/70 hover:text-base-content ${config.hoverStyle}`
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-1 focus:ring-offset-base-200
            `}
          >
            <FontAwesomeIcon
              icon={config.icon}
              className={`${sizeConfig.icon} ${isSelected ? '' : 'opacity-70'}`}
            />
            <span>{config.label}</span>
          </button>
        );
      })}
    </div>
  );
});

// Compact badge version for displaying current mode without controls
export const PermissionModeBadge = memo(function PermissionModeBadge({
  mode,
}: {
  mode: PermissionOverrideMode;
}) {
  const config = MODE_CONFIG[mode];

  if (mode === 'normal') {
    return null; // Don't show badge for normal mode
  }

  return (
    <div
      className={`
        inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium
        ${mode === 'yolo' ? 'bg-amber-950/50 text-amber-400 ring-1 ring-amber-400/30' : ''}
        ${mode === 'read-only' ? 'bg-green-950/50 text-green-400 ring-1 ring-green-400/30' : ''}
      `}
      title={config.description}
    >
      <FontAwesomeIcon icon={config.icon} className="text-xs" />
      <span>{config.label}</span>
    </div>
  );
});
