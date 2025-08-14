import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';

interface NavigationButtonProps {
  icon: IconDefinition;
  onClick: () => void;
  title?: string;
  isActive?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'sidebar' | 'toolbar' | 'minimal';
  className?: string;
}

export default function NavigationButton({
  icon,
  onClick,
  title,
  isActive = false,
  disabled = false,
  size = 'md',
  variant = 'sidebar',
  className = '',
}: NavigationButtonProps) {
  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'p-1.5';
      case 'md':
        return 'p-2';
      case 'lg':
        return 'p-3';
      default:
        return 'p-2';
    }
  };

  const getIconSize = () => {
    switch (size) {
      case 'sm':
        return 'w-4 h-4';
      case 'md':
        return 'w-5 h-5';
      case 'lg':
        return 'w-6 h-6';
      default:
        return 'w-5 h-5';
    }
  };

  const getVariantClasses = () => {
    const baseClasses = 'rounded-lg transition-colors';

    if (disabled) {
      return `${baseClasses} opacity-50 cursor-not-allowed`;
    }

    switch (variant) {
      case 'sidebar':
        return `${baseClasses} hover:bg-base-200 ${
          isActive ? 'bg-primary/10 text-primary' : 'text-base-content/60'
        }`;
      case 'toolbar':
        return `${baseClasses} hover:bg-base-200 border border-transparent hover:border-base-300 ${
          isActive ? 'bg-primary text-primary-content border-primary' : 'text-base-content/70'
        }`;
      case 'minimal':
        return `${baseClasses} hover:bg-base-200/50 ${
          isActive ? 'text-primary' : 'text-base-content/60'
        }`;
      default:
        return `${baseClasses} hover:bg-base-200 text-base-content/60`;
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${getSizeClasses()} ${getVariantClasses()} ${className}`}
      title={title}
      aria-label={title}
    >
      <FontAwesomeIcon icon={icon} className={getIconSize()} />
    </button>
  );
}
