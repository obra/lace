// ABOUTME: Error boundary component to catch and display React errors gracefully
// ABOUTME: Prevents entire app crashes and provides user-friendly error messages

'use client';

import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }

      // Default error UI
      return (
        <div className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center">
          <div className="max-w-md w-full bg-gray-800 rounded-lg p-6 shadow-lg">
            <h1 className="text-2xl font-bold text-red-500 mb-4">Something went wrong</h1>
            <p className="text-gray-300 mb-4">
              An unexpected error occurred. The error has been logged and we&apos;ll look into it.
            </p>
            <details className="mb-4">
              <summary className="cursor-pointer text-sm text-gray-400 hover:text-gray-300">
                Error details
              </summary>
              <pre className="mt-2 text-xs bg-gray-900 p-2 rounded overflow-auto">
                {this.state.error.toString()}
              </pre>
            </details>
            <button
              onClick={this.reset}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
