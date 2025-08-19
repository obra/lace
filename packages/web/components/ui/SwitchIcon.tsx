// ABOUTME: Reusable switch/navigation icon component for sibling navigation
// ABOUTME: Generic stacked arrow icon used for switching between related items

'use client';

import React from 'react';

interface SwitchIconProps {
  onClick?: () => void;
  title?: string;
  className?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  'data-testid'?: string;
}

export function SwitchIcon({
  onClick,
  title = 'Switch',
  className = '',
  disabled = false,
  size = 'md',
  'data-testid': testId,
}: SwitchIconProps) {
  const sizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-3.5 h-3.5',
    lg: 'w-4 h-4',
  };

  const buttonClasses = `
    p-1.5 hover:bg-base-200/80 backdrop-blur-sm rounded-lg transition-all duration-200 
    flex-shrink-0 border border-transparent hover:border-base-300/30 disabled:opacity-50
    ${className}
  `;

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={buttonClasses}
        title={title}
        disabled={disabled}
        data-testid={testId}
      >
        <svg
          className={`${sizeClasses[size]} text-base-content/50 hover:text-base-content/70 transition-colors`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
          />
        </svg>
      </button>
    );
  }

  // Static icon version without button wrapper
  return (
    <svg
      className={`${sizeClasses[size]} text-base-content/50 ${className}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
      />
    </svg>
  );
}
