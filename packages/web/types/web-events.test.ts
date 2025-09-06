// ABOUTME: Test error entry and error log entry interface validation
// ABOUTME: Ensures error UI types are properly structured for frontend display

import { describe, it, expect, vi } from 'vitest';
import type { ErrorEntry, AgentErrorLogEntry, TimelineEntry } from '@/types/web-events';
import { getErrorOrigin } from '@/types/web-events';

describe('Error Web Event Types', () => {
  describe('ErrorEntry', () => {
    it('should extend TimelineEntry correctly', () => {
      const errorType = 'provider_failure';
      const errorEntry: ErrorEntry = {
        id: 'error-123',
        type: 'error',
        errorType,
        origin: getErrorOrigin(errorType),
        message: 'Provider API failed',
        context: { providerName: 'anthropic' },
        isRetryable: true,
        retryCount: 1,
        canRetry: true,
        timestamp: new Date(),
      };

      // Should satisfy TimelineEntry interface
      const timelineEntry: TimelineEntry = errorEntry;
      expect(timelineEntry.id).toBe('error-123');
      expect(timelineEntry.type).toBe('error');
      expect(timelineEntry.timestamp).toBeInstanceOf(Date);
    });

    it('should accept all valid error types', () => {
      const errorTypes = [
        'provider_failure',
        'tool_execution',
        'processing_error',
        'timeout',
      ] as const;

      errorTypes.forEach((errorType) => {
        const errorEntry: ErrorEntry = {
          id: `error-${errorType}`,
          type: 'error',
          errorType,
          origin: getErrorOrigin(errorType),
          message: `Test ${errorType} error`,
          isRetryable: false,
          timestamp: new Date(),
        };

        expect(errorEntry.errorType).toBe(errorType);
      });
    });

    it('should handle optional fields correctly', () => {
      const errorEntry: ErrorEntry = {
        id: 'error-123',
        type: 'error',
        errorType: 'tool_execution',
        origin: getErrorOrigin('tool_execution'),
        message: 'Tool failed',
        isRetryable: true,
        timestamp: new Date(),
      };

      expect(errorEntry.context).toBeUndefined();
      expect(errorEntry.retryCount).toBeUndefined();
      expect(errorEntry.canRetry).toBeUndefined();
      expect(errorEntry.retryHandler).toBeUndefined();
    });

    it('should support retry handler function', () => {
      const mockRetryHandler = vi.fn();

      const errorEntry: ErrorEntry = {
        id: 'error-123',
        type: 'error',
        errorType: 'provider_failure',
        origin: getErrorOrigin('provider_failure'),
        message: 'Provider failed',
        isRetryable: true,
        canRetry: true,
        retryHandler: mockRetryHandler,
        timestamp: new Date(),
      };

      expect(errorEntry.retryHandler).toBe(mockRetryHandler);
      expect(typeof errorEntry.retryHandler).toBe('function');
    });
  });

  describe('AgentErrorLogEntry', () => {
    it('should validate complete error log entry', () => {
      const errorLogEntry: AgentErrorLogEntry = {
        id: 'log-error-123',
        timestamp: new Date(),
        errorType: 'provider_failure',
        origin: getErrorOrigin('provider_failure'),
        severity: 'error',
        message: 'Provider API authentication failed',
        context: {
          providerName: 'anthropic',
          modelId: 'claude-3-haiku',
          statusCode: 401,
        },
        isRetryable: true,
        retryCount: 2,
        resolved: false,
        threadId: 'thread-123',
        sessionId: 'session-456',
        providerName: 'anthropic',
        providerInstanceId: 'claude-3',
        modelId: 'claude-3-haiku',
      };

      expect(errorLogEntry.id).toBe('log-error-123');
      expect(errorLogEntry.severity).toBe('error');
      expect(errorLogEntry.resolved).toBe(false);
      expect(errorLogEntry.retryCount).toBe(2);
    });

    it('should accept all valid severity levels', () => {
      const severities = ['warning', 'error', 'critical'] as const;

      severities.forEach((severity) => {
        const errorLogEntry: AgentErrorLogEntry = {
          id: `log-${severity}`,
          timestamp: new Date(),
          errorType: 'processing_error',
          origin: getErrorOrigin('processing_error'),
          severity,
          message: `Test ${severity} level error`,
          context: {},
          isRetryable: false,
          resolved: false,
        };

        expect(errorLogEntry.severity).toBe(severity);
      });
    });

    it('should handle optional fields correctly', () => {
      const minimalErrorLogEntry: AgentErrorLogEntry = {
        id: 'minimal-error',
        timestamp: new Date(),
        errorType: 'timeout',
        origin: getErrorOrigin('timeout'),
        severity: 'warning',
        message: 'Operation timed out',
        context: {},
        isRetryable: true,
        resolved: false,
      };

      expect(minimalErrorLogEntry.retryCount).toBeUndefined();
      expect(minimalErrorLogEntry.threadId).toBeUndefined();
      expect(minimalErrorLogEntry.sessionId).toBeUndefined();
      expect(minimalErrorLogEntry.providerName).toBeUndefined();
      expect(minimalErrorLogEntry.providerInstanceId).toBeUndefined();
      expect(minimalErrorLogEntry.modelId).toBeUndefined();
    });

    it('should support complex context objects', () => {
      const complexContext = {
        providerName: 'openai',
        modelId: 'gpt-4',
        toolName: 'bash',
        toolCallId: 'tool-123',
        workingDirectory: '/home/user/project',
        command: 'npm install',
        exitCode: 1,
        stderr: 'Package not found',
        environment: {
          NODE_ENV: 'development',
          PATH: '/usr/bin:/bin',
        },
      };

      const errorLogEntry: AgentErrorLogEntry = {
        id: 'complex-error',
        timestamp: new Date(),
        errorType: 'tool_execution',
        origin: getErrorOrigin('tool_execution'),
        severity: 'error',
        message: 'Tool execution failed',
        context: complexContext,
        isRetryable: false,
        resolved: false,
      };

      expect(errorLogEntry.context).toEqual(complexContext);
      expect(errorLogEntry.context.environment).toBeDefined();
      expect(errorLogEntry.context.toolName).toBe('bash');
    });
  });
});
