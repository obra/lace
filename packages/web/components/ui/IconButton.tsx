import React from 'react';
import { ButtonHTMLAttributes, forwardRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconDefinition;
  variant?:
    | 'primary'
    | 'secondary'
    | 'accent'
    | 'ghost'
    | 'outline'
    | 'error'
    | 'warning'
    | 'success';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  badge?: string | number;
  loading?: boolean;
  tooltip?: string;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      variant = 'ghost',
      size = 'md',
      badge,
      loading = false,
      tooltip,
      className = '',
      disabled,
      ...props
    },
    ref
  ) => {
    const baseClasses = 'btn btn-square relative';
    const variantClasses = `btn-${variant}`;
    const sizeClasses = `btn-${size}`;

    const iconSizes = {
      xs: 'text-xs',
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-lg',
    };

    return (
      <button
        ref={ref}
        className={`${baseClasses} ${variantClasses} ${sizeClasses} ${className}`}
        disabled={disabled || loading}
        title={tooltip}
        {...props}
      >
        {loading ? (
          <span className="loading loading-spinner loading-sm"></span>
        ) : (
          <FontAwesomeIcon icon={icon} className={iconSizes[size]} />
        )}

        {badge && (
          <div className="badge badge-error badge-xs absolute -top-1 -right-1">{badge}</div>
        )}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';

export default IconButton;
