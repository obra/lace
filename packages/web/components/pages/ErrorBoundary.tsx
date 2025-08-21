// ABOUTME: Standard error boundary component for consistent error handling across pages
// ABOUTME: Provides fallback UI and error reporting when React components crash

'use client';

import React, { Component, type ReactNode } from 'react';
import { Alert } from '@/components/ui/Alert';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

function DefaultErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-[200px] flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <Alert
          variant="error"
          title="Something went wrong"
          description={`An error occurred while loading this page. ${error.message}`}
        />
        <div className="mt-4 flex gap-2">
          <button onClick={reset} className="btn btn-primary btn-sm">
            Try again
          </button>
          <button onClick={() => window.location.reload()} className="btn btn-outline btn-sm">
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}

export class StandardErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Page error boundary caught an error:', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  reset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      const fallback = this.props.fallback;
      if (fallback) {
        return fallback(this.state.error, this.reset);
      }
      return <DefaultErrorFallback error={this.state.error} reset={this.reset} />;
    }

    return this.props.children;
  }
}
