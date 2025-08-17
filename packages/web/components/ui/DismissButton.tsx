// ABOUTME: Standardized dismiss/close button component for consistent UI patterns
// ABOUTME: Based on Modal's dismiss button with proper accessibility and hover states

'use client';

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes } from '@/lib/fontawesome';

export interface DismissButtonProps {
  onClick: () => void;
  ariaLabel?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  disabled?: boolean;
}

export function DismissButton({
  onClick,
  ariaLabel = 'Dismiss',
  size = 'md',
  className = '',
  disabled = false,
}: DismissButtonProps) {
  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'p-1 w-4 h-4';
      case 'md':
        return 'p-1 w-5 h-5';
      case 'lg':
        return 'p-2 w-6 h-6';
      default:
        return 'p-1 w-5 h-5';
    }
  };

  const [padding, iconSize] = getSizeClasses().split(' ').slice(0, 2);
  const iconSizeClass = getSizeClasses().split(' ').slice(2).join(' ');

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        ${padding} hover:bg-base-200 rounded-full transition-colors flex-shrink-0
        disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent
        ${className}
      `}
      aria-label={ariaLabel}
      type="button"
    >
      <FontAwesomeIcon icon={faTimes} className={`${iconSizeClass} text-base-content/60`} />
    </button>
  );
}
