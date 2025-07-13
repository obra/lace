// ABOUTME: Error display component for showing detailed API errors to users
// ABOUTME: Provides clear error messaging with technical details in development mode

'use client';

import { motion } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInfoCircle, faCog } from '~/interfaces/web/lib/fontawesome';

interface ErrorDisplayProps {
  error: string;
  retryCount?: number;
  maxRetries?: number;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export function ErrorDisplay({
  error,
  retryCount = 0,
  maxRetries = 3,
  onRetry,
  onDismiss,
  className = '',
}: ErrorDisplayProps) {
  const canRetry = retryCount < maxRetries && onRetry;
  const [mainError, details] = error.split('\n\nDetails: ');

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className={`alert alert-error ${className}`}
    >
      <div className="flex items-start gap-3 w-full">
        <FontAwesomeIcon
          icon={faInfoCircle}
          className="w-5 h-5 text-error-content mt-0.5 flex-shrink-0"
        />

        <div className="flex-1 min-w-0">
          <div className="font-medium text-error-content mb-1">{mainError}</div>

          {details && (
            <details className="text-sm text-error-content/80">
              <summary className="cursor-pointer hover:text-error-content">
                Technical Details
              </summary>
              <pre className="mt-2 text-xs bg-error-content/10 p-2 rounded overflow-x-auto">
                {details}
              </pre>
            </details>
          )}

          {retryCount > 0 && (
            <div className="text-sm text-error-content/80 mt-1">
              Attempt {retryCount} of {maxRetries}
            </div>
          )}
        </div>

        <div className="flex gap-2 flex-shrink-0">
          {canRetry && (
            <button
              onClick={onRetry}
              className="btn btn-sm btn-outline btn-error"
              disabled={retryCount >= maxRetries}
            >
              <FontAwesomeIcon icon={faCog} className="w-3 h-3" />
              Retry
            </button>
          )}

          {onDismiss && (
            <button onClick={onDismiss} className="btn btn-sm btn-ghost btn-error">
              Dismiss
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
