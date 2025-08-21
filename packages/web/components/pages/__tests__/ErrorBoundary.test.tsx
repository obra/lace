// ABOUTME: Test coverage for StandardErrorBoundary component
// ABOUTME: Verifies error boundary catches errors and displays fallback UI

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StandardErrorBoundary } from '@/components/pages/ErrorBoundary';

// Test component that throws an error when a prop is true
function ThrowError({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error message');
  }
  return <div>No error</div>;
}

describe('StandardErrorBoundary', () => {
  // Mock console.error to avoid cluttering test output
  const originalError = console.error;
  beforeAll(() => {
    console.error = vi.fn();
  });

  afterAll(() => {
    console.error = originalError;
  });

  it('should render children when no error occurs', () => {
    render(
      <StandardErrorBoundary>
        <ThrowError shouldThrow={false} />
      </StandardErrorBoundary>
    );

    expect(screen.getByText('No error')).toBeInTheDocument();
  });

  it('should render error fallback when error occurs', () => {
    render(
      <StandardErrorBoundary>
        <ThrowError shouldThrow={true} />
      </StandardErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/Test error message/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
  });

  it('should reset error state when Try again button is clicked', () => {
    let shouldThrow = true;
    const TestComponent = () => <ThrowError shouldThrow={shouldThrow} />;

    const { rerender } = render(
      <StandardErrorBoundary>
        <TestComponent />
      </StandardErrorBoundary>
    );

    // Verify error boundary shows
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Change the error condition and click try again
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    // Should show normal content after reset
    expect(screen.getByText('No error')).toBeInTheDocument();
  });

  it('should use custom fallback when provided', () => {
    const customFallback = (error: Error, reset: () => void) => (
      <div>
        <span>Custom error: {error.message}</span>
        <button onClick={reset}>Custom reset</button>
      </div>
    );

    render(
      <StandardErrorBoundary fallback={customFallback}>
        <ThrowError shouldThrow={true} />
      </StandardErrorBoundary>
    );

    expect(screen.getByText('Custom error: Test error message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custom reset' })).toBeInTheDocument();
  });

  it('should log error to console', () => {
    render(
      <StandardErrorBoundary>
        <ThrowError shouldThrow={true} />
      </StandardErrorBoundary>
    );

    expect(console.error).toHaveBeenCalledWith(
      'Page error boundary caught an error:',
      expect.objectContaining({
        error: 'Test error message',
        stack: expect.any(String),
        componentStack: expect.any(String),
      })
    );
  });
});
