// ABOUTME: Toast notification component for immediate error feedback
// ABOUTME: Provides non-intrusive error notifications with auto-dismiss and retry actions

import React, { useEffect, useState, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faExclamationTriangle, 
  faRedo, 
  faTimes,
  faInfo
} from '@/lib/fontawesome';
import type { ErrorType } from '@/types/core';

interface ErrorToastProps {
  errorType: ErrorType;
  message: string;
  severity?: 'warning' | 'error' | 'critical';
  isRetryable?: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
  autoDismiss?: number; // milliseconds, 0 means no auto-dismiss
  compact?: boolean;
}

export function ErrorToast({
  errorType,
  message,
  severity = 'error',
  isRetryable = false,
  onRetry,
  onDismiss,
  autoDismiss = 5000,
  compact = false
}: ErrorToastProps): React.JSX.Element {
  const [isVisible, setIsVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss functionality
  useEffect(() => {
    if (autoDismiss > 0) {
      timerRef.current = setTimeout(() => {
        setIsVisible(false);
        onDismiss?.();
      }, autoDismiss);

      return () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      };
    }
  }, [autoDismiss, onDismiss]);

  const getToastIcon = () => {
    switch (severity) {
      case 'critical': return faExclamationTriangle;
      case 'error': return faExclamationTriangle;
      case 'warning': return faExclamationTriangle;
      default: return faInfo;
    }
  };

  const getToastClass = () => {
    const baseClass = 'toast toast-top toast-end';
    if (!isVisible) return `${baseClass} opacity-0 pointer-events-none`;
    return baseClass;
  };

  const getAlertClass = () => {
    switch (severity) {
      case 'critical': return 'alert-error';
      case 'error': return 'alert-error';
      case 'warning': return 'alert-warning';
      default: return 'alert-info';
    }
  };

  const formatErrorType = (type: ErrorType) => {
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const handleDismiss = () => {
    // Clear the auto-dismiss timer to prevent double onDismiss calls
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsVisible(false);
    onDismiss?.();
  };

  if (!isVisible) {
    return <></>;
  }

  return (
    <div className={getToastClass()}>
      <div className={`alert ${getAlertClass()} shadow-lg max-w-sm`} role="alert" aria-live="assertive" aria-atomic="true">
        <FontAwesomeIcon icon={getToastIcon()} />
        
        <div className="flex-1 min-w-0">
          {!compact && (
            <div className="font-medium text-sm mb-1">
              {formatErrorType(errorType)}
            </div>
          )}
          <div className={compact ? "text-sm" : "text-xs"}>
            {message}
          </div>
        </div>
        
        <div className="flex gap-1">
          {isRetryable && onRetry && (
            <button 
              type="button"
              className="btn btn-xs btn-ghost"
              onClick={onRetry}
              title="Retry"
              aria-label="Retry error"
            >
              <FontAwesomeIcon icon={faRedo} />
            </button>
          )}
          <button 
            type="button"
            className="btn btn-xs btn-ghost"
            onClick={handleDismiss}
            title="Dismiss"
            aria-label="Dismiss notification"
          >
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>
      </div>
    </div>
  );
}