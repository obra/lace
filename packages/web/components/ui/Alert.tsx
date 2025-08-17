// ABOUTME: Reusable alert component for displaying status messages with semantic colors
// ABOUTME: Provides consistent styling and proper contrast across all alert types

'use client';

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCheckCircle,
  faExclamationTriangle,
  faInfoCircle,
  faTimesCircle,
} from '@/lib/fontawesome';

export type AlertVariant = 'success' | 'warning' | 'error' | 'info';

export interface AlertProps {
  variant: AlertVariant;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
  showIcon?: boolean;
  onDismiss?: () => void;
}

const alertConfig = {
  success: {
    icon: faCheckCircle,
    containerClass: 'bg-success/10 border-success/20',
    iconClass: 'text-success',
    titleClass: 'text-base-content',
    descriptionClass: 'text-base-content/70',
  },
  warning: {
    icon: faExclamationTriangle,
    containerClass: 'bg-warning/10 border-warning/20',
    iconClass: 'text-warning',
    titleClass: 'text-base-content',
    descriptionClass: 'text-base-content/70',
  },
  error: {
    icon: faTimesCircle,
    containerClass: 'bg-error/10 border-error/20',
    iconClass: 'text-error',
    titleClass: 'text-base-content',
    descriptionClass: 'text-base-content/70',
  },
  info: {
    icon: faInfoCircle,
    containerClass: 'bg-info/10 border-info/20',
    iconClass: 'text-info',
    titleClass: 'text-base-content',
    descriptionClass: 'text-base-content/70',
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
}: AlertProps) {
  const config = alertConfig[variant];

  return (
    <div className={`border rounded-lg p-3 ${config.containerClass} ${className}`}>
      <div className="flex items-start gap-2">
        {showIcon && (
          <FontAwesomeIcon
            icon={config.icon}
            className={`w-4 h-4 mt-0.5 flex-shrink-0 ${config.iconClass}`}
          />
        )}
        <div className="flex-1 text-sm">
          <div className={`font-medium ${config.titleClass}`}>{title}</div>
          {description && <div className={`${config.descriptionClass} mt-1`}>{description}</div>}
          {children && <div className="mt-2">{children}</div>}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-base-content/60 hover:text-base-content/80 transition-colors"
            aria-label="Dismiss alert"
          >
            <FontAwesomeIcon icon={faTimesCircle} className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
