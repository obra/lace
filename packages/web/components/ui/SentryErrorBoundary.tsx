// ABOUTME: Error boundary component with Sentry integration for catching and reporting React errors.

'use client';

import React, { Component, ReactNode } from 'react';
import * as Sentry from '@sentry/nextjs';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  showDialog?: boolean;
}

interface State {
  hasError: boolean;
  eventId?: string;
}

export class SentryErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const eventId = Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: errorInfo.componentStack,
        },
      },
    });

    this.setState({ eventId });

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Error caught by boundary:', error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
          <div className="bg-base-200 rounded-lg p-8 max-w-md w-full text-center">
            <div className="text-6xl mb-4">⚠️</div>
            <h2 className="text-xl font-semibold mb-4 text-base-content">Something went wrong</h2>
            <p className="text-base-content/70 mb-6">
              We&apos;re sorry, but an unexpected error occurred. The error has been reported and
              we&apos;re working to fix it.
            </p>

            <div className="space-y-3">
              <button onClick={() => window.location.reload()} className="btn btn-primary w-full">
                Reload Page
              </button>

              {this.props.showDialog && (
                <button
                  onClick={() => {
                    if (this.state.eventId) {
                      Sentry.showReportDialog({ eventId: this.state.eventId });
                    }
                  }}
                  className="btn btn-outline w-full"
                >
                  Report Problem
                </button>
              )}
            </div>

            {process.env.NODE_ENV === 'development' && this.state.eventId && (
              <p className="text-xs text-base-content/50 mt-4">Event ID: {this.state.eventId}</p>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Convenience wrapper with default fallback
export function withSentryErrorBoundary<T extends object>(
  Component: React.ComponentType<T>
): React.ComponentType<T> {
  const WrappedComponent = (props: T) => (
    <SentryErrorBoundary>
      <Component {...props} />
    </SentryErrorBoundary>
  );

  WrappedComponent.displayName = `withSentryErrorBoundary(${Component.displayName || Component.name})`;

  return WrappedComponent;
}
