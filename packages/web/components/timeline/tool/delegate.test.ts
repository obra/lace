// ABOUTME: Test suite for delegate tool renderer TDD implementation
// ABOUTME: Comprehensive tests for task delegation tool display customizations

import { describe, test, expect } from 'vitest';
import { faUserFriends } from '@fortawesome/free-solid-svg-icons';
import type { ToolResult } from '@/types/core';
import { delegateRenderer } from './delegate';

describe('Delegate Tool Renderer', () => {
  const mockDelegateArgs = {
    instructions: 'Review the authentication code and fix any security issues',
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307',
    timeout: 300000,
  };

  const mockSuccessResult: ToolResult = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          delegateId: 'delegate-123',
          status: 'completed',
          result:
            'Successfully reviewed authentication code. Found and fixed 3 security vulnerabilities:\n1. SQL injection in login endpoint\n2. Missing CSRF protection\n3. Weak password hashing algorithm\n\nAll issues have been resolved and tests are passing.',
          tokensUsed: 1247,
          executionTime: 45000,
          model: 'claude-3-haiku-20240307',
        }),
      },
    ],
    isError: false,
  };

  const mockErrorResult: ToolResult = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          delegateId: 'delegate-456',
          status: 'failed',
          error: 'Timeout exceeded - delegate did not complete within 5 minutes',
          tokensUsed: 850,
          executionTime: 300000,
        }),
      },
    ],
    isError: false, // Will be detected by status
  };

  const mockTimeoutResult: ToolResult = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          delegateId: 'delegate-789',
          status: 'timeout',
          partialResult: 'Started code review but ran out of time...',
          tokensUsed: 2150,
          executionTime: 300000,
        }),
      },
    ],
    isError: false,
  };

  describe('getSummary', () => {
    test('should create formatted summary for delegation', () => {
      const summary = delegateRenderer.getSummary?.(mockDelegateArgs);
      expect(summary).toBe(
        'Delegate: "Review the authentication code and fix any security issues" (claude-3-haiku-20240307)'
      );
    });

    test('should truncate long instructions', () => {
      const longInstructions = {
        instructions:
          'This is a very long instruction that should be truncated because it exceeds the reasonable length for a summary display and would make the UI look cluttered',
      };
      const summary = delegateRenderer.getSummary?.(longInstructions);
      expect(summary).toBe(
        'Delegate: "This is a very long instruction that should be truncated because it exceeds t..."'
      );
    });

    test('should handle missing instructions gracefully', () => {
      const summary = delegateRenderer.getSummary?.({});
      expect(summary).toBe('Delegate task to subagent');
    });

    test('should show model information when available', () => {
      const argsWithModel = {
        instructions: 'Simple task',
        model: 'claude-3-sonnet-20240229',
      };
      const summary = delegateRenderer.getSummary?.(argsWithModel);
      expect(summary).toBe('Delegate: "Simple task" (claude-3-sonnet-20240229)');
    });
  });

  describe('isError', () => {
    test('should detect error results from status', () => {
      const isError = delegateRenderer.isError?.(mockErrorResult);
      expect(isError).toBe(true);
    });

    test('should detect timeout as error', () => {
      const isError = delegateRenderer.isError?.(mockTimeoutResult);
      expect(isError).toBe(true);
    });

    test('should detect success results correctly', () => {
      const isError = delegateRenderer.isError?.(mockSuccessResult);
      expect(isError).toBe(false);
    });

    test('should handle legacy plain text output', () => {
      const legacyResult = {
        content: [{ type: 'text', text: 'Delegation completed successfully' }],
        isError: false,
      } as ToolResult;
      const isError = delegateRenderer.isError?.(legacyResult);
      expect(isError).toBe(false);
    });

    test('should prioritize isError flag over status', () => {
      const flaggedError: ToolResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'completed',
              result: 'Success message',
            }),
          },
        ],
        isError: true, // Explicitly flagged as error
      };
      const isError = delegateRenderer.isError?.(flaggedError);
      expect(isError).toBe(true);
    });
  });

  describe('renderResult', () => {
    test('should render successful delegation results', () => {
      const resultNode = delegateRenderer.renderResult?.(mockSuccessResult);
      expect(resultNode).toBeDefined();
      expect(typeof resultNode).toBe('object');
    });

    test('should render error results with details', () => {
      const resultNode = delegateRenderer.renderResult?.(mockErrorResult);
      expect(resultNode).toBeDefined();
      expect(typeof resultNode).toBe('object');
    });

    test('should render timeout results with partial output', () => {
      const resultNode = delegateRenderer.renderResult?.(mockTimeoutResult);
      expect(resultNode).toBeDefined();
      expect(typeof resultNode).toBe('object');
    });

    test('should handle empty content', () => {
      const emptyResult: ToolResult = {
        content: [],
        isError: false,
      };
      const resultNode = delegateRenderer.renderResult?.(emptyResult);
      expect(resultNode).toBeDefined();
    });

    test('should handle legacy plain text output', () => {
      const legacyResult: ToolResult = {
        content: [
          {
            type: 'text',
            text: 'Task delegated to subagent. Waiting for completion...',
          },
        ],
        isError: false,
      };
      const resultNode = delegateRenderer.renderResult?.(legacyResult);
      expect(resultNode).toBeDefined();
    });

    test('should show token usage and execution time when available', () => {
      const detailedResult: ToolResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'completed',
              result: 'Task completed successfully',
              tokensUsed: 1500,
              executionTime: 30000,
              model: 'claude-3-haiku-20240307',
            }),
          },
        ],
        isError: false,
      };
      const resultNode = delegateRenderer.renderResult?.(detailedResult);
      expect(resultNode).toBeDefined();
    });

    test('should handle in-progress delegation', () => {
      const inProgressResult: ToolResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'in_progress',
              delegateId: 'delegate-999',
              startedAt: '2025-01-15T10:30:00Z',
            }),
          },
        ],
        isError: false,
      };
      const resultNode = delegateRenderer.renderResult?.(inProgressResult);
      expect(resultNode).toBeDefined();
    });
  });

  describe('getIcon', () => {
    test('should return user friends icon', () => {
      const icon = delegateRenderer.getIcon?.();
      expect(icon).toBe(faUserFriends);
    });
  });

  describe('integration with tool renderer system', () => {
    test('should have all expected methods defined', () => {
      expect(delegateRenderer.getSummary).toBeDefined();
      expect(delegateRenderer.isError).toBeDefined();
      expect(delegateRenderer.renderResult).toBeDefined();
      expect(delegateRenderer.getIcon).toBeDefined();
    });

    test('should be compatible with ToolRenderer interface', () => {
      // Type check - if this compiles, the interface is compatible
      const renderer = delegateRenderer;
      expect(typeof renderer.getSummary).toBe('function');
      expect(typeof renderer.isError).toBe('function');
      expect(typeof renderer.renderResult).toBe('function');
      expect(typeof renderer.getIcon).toBe('function');
    });
  });
});
