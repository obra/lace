// ABOUTME: Reusable alert component for displaying status messages with semantic colors
// ABOUTME: Provides consistent styling and proper contrast across all alert types

'use client';

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheckCircle, faExclamationTriangle, faInfoCircle } from '@/lib/fontawesome';
import { DismissButton } from '@/components/ui/DismissButton';

export type AlertVariant = 'success' | 'warning' | 'error' | 'info';
export type AlertLayout = 'vertical' | 'horizontal';
export type AlertStyle = 'default' | 'soft' | 'outline' | 'dash';

export interface AlertProps {
  variant: AlertVariant;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
  showIcon?: boolean;
  onDismiss?: () => void;
  layout?: AlertLayout;
  style?: AlertStyle;
}

const alertConfig = {
  success: {
    icon: faCheckCircle,
    alertClass: 'alert-success',
  },
  warning: {
    icon: faExclamationTriangle,
    alertClass: 'alert-warning',
  },
  error: {
    icon: faExclamationTriangle,
    alertClass: 'alert-error',
  },
  info: {
    icon: faInfoCircle,
    alertClass: 'alert-info',
  },
};

export function Alert({
  variant,
  title,
  description,
  children,
  className = '',
  showIcon = true,
  onDismiss,
  layout = 'vertical',
  style = 'default',
}: AlertProps) {
  const config = alertConfig[variant];

  const layoutClass = layout === 'horizontal' ? 'alert-vertical sm:alert-horizontal' : '';
  const styleClass = style !== 'default' ? `alert-${style}` : '';

  return (
    <div
      className={`alert ${config.alertClass} ${styleClass} ${layoutClass} ${className}`}
      role={variant === 'error' || variant === 'warning' ? 'alert' : 'status'}
      aria-live={variant === 'error' || variant === 'warning' ? 'assertive' : 'polite'}
    >
      {showIcon && <FontAwesomeIcon icon={config.icon} className="w-4 h-4 flex-shrink-0" />}
      <div className="flex-1">
        <div className="font-medium">{title}</div>
        {description && <div className="mt-1 opacity-80">{description}</div>}
        {children && <div className="mt-2">{children}</div>}
      </div>
      {onDismiss && <DismissButton onClick={onDismiss} size="sm" ariaLabel="Dismiss alert" />}
    </div>
  );
}
