// ABOUTME: Toast notification component for success feedback
// ABOUTME: Provides non-intrusive success notifications with auto-dismiss

import React, { useEffect, useState, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faTimes } from '@/lib/fontawesome';

interface SuccessToastProps {
  message: string;
  onDismiss?: () => void;
  autoDismiss?: number; // milliseconds, 0 means no auto-dismiss
  compact?: boolean;
}

export function SuccessToast({
  message,
  onDismiss,
  autoDismiss = 3000,
  compact = false,
}: SuccessToastProps): React.JSX.Element {
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

  const getToastClass = () => {
    const baseClass = 'toast toast-top toast-end';
    if (!isVisible) return `${baseClass} opacity-0 pointer-events-none`;
    return baseClass;
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
      <div
        className="alert alert-success shadow-lg max-w-sm"
        role="alert"
        aria-live="polite"
        aria-atomic="true"
      >
        <FontAwesomeIcon icon={faCheck} />

        <div className="flex-1 min-w-0">
          <div className={compact ? 'text-sm' : 'text-xs'}>{message}</div>
        </div>

        <div className="flex gap-1">
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
