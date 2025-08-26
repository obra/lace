// ABOUTME: Test error display components for proper rendering and interaction
// ABOUTME: Verifies error visualization, context display, and retry functionality

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorDisplay, ErrorLogEntry, ErrorToast } from '@/components/errors';
import type { AgentErrorLogEntry as AgentErrorLogEntryType, ErrorEntry } from '@/types/web-events';

describe('Error Display Components', () => {
  describe('ErrorDisplay', () => {
    const mockErrorLogEntry: AgentErrorLogEntryType = {
      id: 'error-123',
      timestamp: new Date(),
      errorType: 'provider_failure',
      severity: 'error',
      message: 'Provider API rate limit exceeded',
      context: {
        providerName: 'anthropic',
        modelId: 'claude-3-5-haiku-20241022',
      },
      isRetryable: true,
      retryCount: 2,
      resolved: false,
    };

    it('should render error information correctly', () => {
      render(<ErrorDisplay error={mockErrorLogEntry} />);
      
      expect(screen.getByText('Provider Failure')).toBeInTheDocument();
      expect(screen.getByText('Provider API rate limit exceeded')).toBeInTheDocument();
      expect(screen.getByText('error')).toBeInTheDocument(); // severity badge
      expect(screen.getByText('Retryable')).toBeInTheDocument();
    });

    it('should show context when enabled', () => {
      render(<ErrorDisplay error={mockErrorLogEntry} showContext={true} />);
      
      expect(screen.getByText('Error Context')).toBeInTheDocument();
    });

    it('should hide context when disabled', () => {
      render(<ErrorDisplay error={mockErrorLogEntry} showContext={false} />);
      
      expect(screen.queryByText('Error Context')).not.toBeInTheDocument();
    });

    it('should show retry button for retryable errors', () => {
      const onRetry = vi.fn();
      render(<ErrorDisplay error={mockErrorLogEntry} onRetry={onRetry} />);
      
      const retryButton = screen.getByRole('button', { name: /retry/i });
      expect(retryButton).toBeInTheDocument();
      
      fireEvent.click(retryButton);
      expect(onRetry).toHaveBeenCalledOnce();
    });

    it('should hide retry button for non-retryable errors', () => {
      const nonRetryableError = { ...mockErrorLogEntry, isRetryable: false };
      render(<ErrorDisplay error={nonRetryableError} />);
      
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('should render compact mode correctly', () => {
      render(<ErrorDisplay error={mockErrorLogEntry} compact={true} />);
      
      expect(screen.getByText('Provider Failure')).toBeInTheDocument();
      expect(screen.getByText('Provider API rate limit exceeded')).toBeInTheDocument();
    });
  });

  describe('ErrorLogEntry', () => {
    const mockErrorEntry: ErrorEntry = {
      id: 'timeline-error-456',
      type: 'error',
      errorType: 'tool_execution',
      message: 'Tool execution failed: command not found',
      context: {
        phase: 'tool_execution',
        toolName: 'bash',
        toolCallId: 'tool-call-789',
      },
      isRetryable: false,
      timestamp: new Date(),
    };

    it('should render timeline error entry correctly', () => {
      render(<ErrorLogEntry error={mockErrorEntry} />);
      
      expect(screen.getByText('Tool Execution')).toBeInTheDocument();
      expect(screen.getByText('Tool execution failed: command not found')).toBeInTheDocument();
      expect(screen.getByText(/during tool execution/)).toBeInTheDocument();
      expect(screen.getByText(/using bash tool/)).toBeInTheDocument();
    });

    it('should show timestamp when enabled', () => {
      render(<ErrorLogEntry error={mockErrorEntry} showTimestamp={true} />);
      
      // TimestampDisplay should render time text in HH:MM format
      const timestampText = screen.queryByText(/\d{1,2}:\d{2}/);
      expect(timestampText).toBeInTheDocument();
    });

    it('should hide timestamp when disabled', () => {
      render(<ErrorLogEntry error={mockErrorEntry} showTimestamp={false} />);
      
      // TimestampDisplay should not render time text in HH:MM format when timestamp is hidden
      const timestampText = screen.queryByText(/\d{1,2}:\d{2}/);
      expect(timestampText).not.toBeInTheDocument();
    });

    it('should show retry button for retryable errors with canRetry', () => {
      const retryableError = { 
        ...mockErrorEntry, 
        isRetryable: true, 
        canRetry: true 
      };
      const onRetry = vi.fn();
      
      render(<ErrorLogEntry error={retryableError} onRetry={onRetry} />);
      
      const retryButton = screen.getByRole('button');
      expect(retryButton).toBeInTheDocument();
      
      fireEvent.click(retryButton);
      expect(onRetry).toHaveBeenCalledOnce();
    });
  });

  describe('ErrorToast', () => {
    it('should render error toast with message', () => {
      render(
        <ErrorToast 
          errorType="provider_failure"
          message="Network timeout occurred"
        />
      );
      
      expect(screen.getByText('Provider Failure')).toBeInTheDocument();
      expect(screen.getByText('Network timeout occurred')).toBeInTheDocument();
    });

    it('should show retry button for retryable errors', () => {
      const onRetry = vi.fn();
      render(
        <ErrorToast 
          errorType="timeout"
          message="Request timed out"
          isRetryable={true}
          onRetry={onRetry}
        />
      );
      
      const retryButton = screen.getByRole('button', { name: /retry/i });
      expect(retryButton).toBeInTheDocument();
      
      fireEvent.click(retryButton);
      expect(onRetry).toHaveBeenCalledOnce();
    });

    it('should call onDismiss when dismiss button is clicked', () => {
      const onDismiss = vi.fn();
      render(
        <ErrorToast 
          errorType="processing_error"
          message="Processing failed"
          onDismiss={onDismiss}
        />
      );
      
      const dismissButton = screen.getByTitle('Dismiss');
      fireEvent.click(dismissButton);
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('should auto-dismiss after specified time', async () => {
      // Use fake timers for deterministic timing
      vi.useFakeTimers();
      
      const onDismiss = vi.fn();
      render(
        <ErrorToast 
          errorType="streaming_error"
          message="Stream interrupted"
          autoDismiss={100} // 100ms for fast test
          onDismiss={onDismiss}
        />
      );
      
      // Fast-forward time to trigger auto-dismiss
      vi.advanceTimersByTime(150);
      expect(onDismiss).toHaveBeenCalledOnce();
      
      vi.useRealTimers();
    });

    it('should render compact mode correctly', () => {
      render(
        <ErrorToast 
          errorType="tool_execution"
          message="Tool failed"
          compact={true}
        />
      );
      
      expect(screen.getByText('Tool failed')).toBeInTheDocument();
    });
  });
});