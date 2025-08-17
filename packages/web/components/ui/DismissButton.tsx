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
  const sizeStyles: Record<'sm' | 'md' | 'lg', { button: string; icon: string }> = {
    sm: { button: 'p-1', icon: 'w-4 h-4' },
    md: { button: 'p-1', icon: 'w-5 h-5' },
    lg: { button: 'p-2', icon: 'w-6 h-6' },
  };
  const sizeClass = sizeStyles[size];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        ${sizeClass.button} hover:bg-base-200 rounded-full transition-colors flex-shrink-0
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-300
        disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent
        ${className}
      `}
      aria-label={ariaLabel}
      type="button"
    >
      <FontAwesomeIcon icon={faTimes} className={`${sizeClass.icon} text-base-content/60`} />
    </button>
  );
}
