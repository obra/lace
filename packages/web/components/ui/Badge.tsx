import React from 'react';
import { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?:
    | 'default'
    | 'primary'
    | 'secondary'
    | 'accent'
    | 'success'
    | 'warning'
    | 'error'
    | 'info'
    | 'outline';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const Badge = ({ children, variant = 'default', size = 'sm', className = '' }: BadgeProps) => {
  const baseClasses = 'badge';

  const variantClasses = {
    default: '',
    primary: 'badge-primary',
    secondary: 'badge-secondary',
    accent: 'badge-accent',
    success: 'badge-success',
    warning: 'badge-warning',
    error: 'badge-error',
    info: 'badge-info',
    outline: 'badge-outline',
  };

  const sizeClasses = {
    xs: 'badge-xs',
    sm: 'badge-sm',
    md: '',
    lg: 'badge-lg',
  };

  return (
    <div className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}>
      {children}
    </div>
  );
};

export default Badge;
