// ABOUTME: Display component for error events in timeline and error log
// ABOUTME: Shows error details, context, and recovery actions with DaisyUI styling

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExclamationTriangle, faRedo, faInfo } from '@/lib/fontawesome';
import type { AgentErrorLogEntry } from '@/types/web-events';

interface ErrorDisplayProps {
  error: AgentErrorLogEntry;
  showContext?: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
}

export function ErrorDisplay({ 
  error, 
  showContext = true, 
  onRetry, 
  onDismiss, 
  compact = false 
}: ErrorDisplayProps): React.JSX.Element {
  const getErrorIcon = () => {
    switch (error.severity) {
      case 'critical': return faExclamationTriangle;
      case 'error': return faExclamationTriangle;
      case 'warning': return faInfo;
      default: return faInfo;
    }
  };

  const getAlertClass = () => {
    switch (error.severity) {
      case 'critical': return 'alert-error';
      case 'error': return 'alert-error';
      case 'warning': return 'alert-warning';
      default: return 'alert-info';
    }
  };

  const formatErrorType = (errorType: string) => {
    return errorType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  if (compact) {
    return (
      <div className={`alert ${getAlertClass()} compact`} role="alert">
        <FontAwesomeIcon icon={getErrorIcon()} />
        <div>
          <div className="font-medium">{formatErrorType(error.errorType)}</div>
          <div className="text-sm opacity-80">{error.message}</div>
        </div>
        {error.isRetryable && onRetry && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onRetry}>
            <FontAwesomeIcon icon={faRedo} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`alert ${getAlertClass()}`} role="alert">
      <FontAwesomeIcon icon={getErrorIcon()} />
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium">{formatErrorType(error.errorType)}</span>
          <span className="badge badge-outline text-xs">{error.severity}</span>
          {error.isRetryable && (
            <span className="badge badge-success badge-sm">Retryable</span>
          )}
        </div>
        
        <div className="text-sm">{error.message}</div>
        
        {showContext && Object.keys(error.context).length > 0 && (
          <div className="mt-2">
            <details className="collapse collapse-arrow">
              <summary className="collapse-title text-xs font-medium">
                Error Context
              </summary>
              <div className="collapse-content">
                <div className="bg-base-200 rounded p-2 text-xs font-mono">
                  {Object.entries(error.context).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <span className="text-base-content/60">{key}:</span>
                      <span>{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          </div>
        )}
        
        {error.retryCount && error.retryCount > 0 && (
          <div className="mt-1 text-xs opacity-60">
            Retry attempt: {error.retryCount}
          </div>
        )}
      </div>
      
      <div className="flex gap-2">
        {error.isRetryable && onRetry && (
          <button type="button" className="btn btn-sm btn-primary" onClick={onRetry}>
            <FontAwesomeIcon icon={faRedo} className="mr-1" />
            Retry
          </button>
        )}
        {onDismiss && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}