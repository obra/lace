// ABOUTME: Timeline entry component for displaying error events in the conversation flow
// ABOUTME: Integrates with timeline system using TimelineEntry interface and error-specific styling

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExclamationTriangle, faClock, faRedo } from '@/lib/fontawesome';
import TimestampDisplay from '@/components/ui/TimestampDisplay';
import type { ErrorEntry } from '@/types/web-events';

interface ErrorLogEntryProps {
  error: ErrorEntry;
  onRetry?: () => void;
  showTimestamp?: boolean;
  showContext?: boolean;
}

export function ErrorLogEntry({
  error,
  onRetry,
  showTimestamp = true,
  showContext = false,
}: ErrorLogEntryProps): React.JSX.Element {
  const getErrorSeverityClass = () => {
    switch (error.errorType) {
      case 'provider_failure':
      case 'timeout':
        return 'text-warning';
      case 'tool_execution':
      case 'processing_error':
        return 'text-error';
      case 'streaming_error':
        return 'text-info';
      default:
        return 'text-base-content';
    }
  };

  const formatErrorType = (errorType: string) => {
    return errorType.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const getPhaseDescription = (phase?: string) => {
    switch (phase) {
      case 'provider_response':
        return 'during AI response';
      case 'tool_execution':
        return 'during tool execution';
      case 'conversation_processing':
        return 'during processing';
      case 'initialization':
        return 'during initialization';
      default:
        return 'in unknown phase';
    }
  };

  return (
    <div className="border-l-4 border-error bg-error/5 rounded-r p-3 my-2">
      <div className="flex items-start gap-3">
        <FontAwesomeIcon
          icon={faExclamationTriangle}
          className={`mt-1 ${getErrorSeverityClass()}`}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm">{formatErrorType(error.errorType)}</span>
            {showTimestamp && (
              <>
                <FontAwesomeIcon icon={faClock} className="text-xs opacity-50" />
                <span data-testid="timestamp">
                  <TimestampDisplay timestamp={error.timestamp} />
                </span>
              </>
            )}
            {error.isRetryable && <span className="badge badge-warning badge-xs">Retryable</span>}
          </div>

          <div className="text-sm text-base-content/80 mb-2">{error.message}</div>

          {error.context && Object.keys(error.context).length > 0 && (
            <div className="text-xs opacity-60 mb-2">
              Failed{' '}
              {getPhaseDescription(
                typeof error.context.phase === 'string' ? error.context.phase : ''
              )}
              {error.context.toolName && typeof error.context.toolName === 'string'
                ? ` using ${error.context.toolName} tool`
                : ''}
              {error.context.providerName && typeof error.context.providerName === 'string'
                ? ` via ${error.context.providerName} provider`
                : ''}
            </div>
          )}

          {showContext && error.context && (
            <details className="collapse collapse-arrow mt-2">
              <summary className="collapse-title text-xs font-medium py-1">
                Technical Details
              </summary>
              <div className="collapse-content">
                <div className="bg-base-200 rounded p-2 text-xs font-mono">
                  {Object.entries(error.context).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <span className="text-base-content/60 min-w-0 flex-shrink-0">{key}:</span>
                      <span className="min-w-0 break-all">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}

          {error.retryCount && error.retryCount > 0 && (
            <div className="text-xs opacity-50 mt-1">Retry attempt: {error.retryCount}</div>
          )}
        </div>

        {error.isRetryable && error.canRetry && onRetry && (
          <button
            className="btn btn-xs btn-warning"
            onClick={onRetry}
            title="Retry this operation"
            aria-label="Retry this operation"
          >
            <FontAwesomeIcon icon={faRedo} />
          </button>
        )}
      </div>
    </div>
  );
}
