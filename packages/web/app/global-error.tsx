// ABOUTME: Global error boundary with Sentry integration for React rendering errors
// ABOUTME: Catches unhandled React errors and reports them to Sentry before showing fallback UI
'use client';

import * as Sentry from '@sentry/react';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report the error to Sentry
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <div className="min-h-screen flex items-center justify-center bg-base-200">
          <div className="max-w-md w-full bg-base-100 shadow-lg rounded-lg p-6 text-center">
            <h2 className="text-2xl font-bold text-error mb-4">Something went wrong!</h2>
            <p className="text-base-content/70 mb-4">
              An unexpected error occurred. This has been reported automatically.
            </p>
            {error.digest && (
              <p className="text-sm text-base-content/50 mb-4">Error ID: {error.digest}</p>
            )}
            <button onClick={reset} className="btn btn-primary">
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
