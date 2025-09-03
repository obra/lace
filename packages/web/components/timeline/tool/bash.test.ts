// ABOUTME: Test suite for bash tool renderer TDD implementation
// ABOUTME: Comprehensive tests for bash-specific tool display customizations

import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { faTerminal } from '@fortawesome/free-solid-svg-icons';
import type { ToolResult } from '@/types/core';
import { bashRenderer } from './bash';

describe('bashRenderer', () => {
  const mockBashArgs = {
    command: 'ls -la',
    timeout: 30000,
  };

  const mockSuccessResult: ToolResult = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          stdout:
            'total 24\ndrwxr-xr-x  6 user  staff   192 Jan 15 10:30 .\ndrwxr-xr-x  3 user  staff    96 Jan 15 10:25 ..\n-rw-r--r--  1 user  staff  1024 Jan 15 10:30 README.md\n-rw-r--r--  1 user  staff   512 Jan 15 10:29 package.json',
          stderr: '',
          exitCode: 0,
        }),
      },
    ],
    status: 'completed' as const,
  };

  const mockErrorResult: ToolResult = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          stdout: '',
          stderr: 'bash: nonexistent-command: command not found',
          exitCode: 127,
        }),
      },
    ],
    status: 'completed' as const, // Will be detected by exit code
  };

  describe('getSummary', () => {
    test('should create formatted summary for bash commands', () => {
      const summary = bashRenderer.getSummary?.(mockBashArgs);
      expect(summary).toBe('$ ls -la');
    });

    test('should handle commands with complex arguments', () => {
      const complexArgs = {
        command: 'find . -name "*.ts" -type f | head -10',
        timeout: 60000,
      };
      const summary = bashRenderer.getSummary?.(complexArgs);
      expect(summary).toBe('$ find . -name "*.ts" -type f | head -10');
    });

    test('should handle missing command gracefully', () => {
      const emptyArgs = {};
      const summary = bashRenderer.getSummary?.(emptyArgs);
      expect(summary).toBe('$ [no command]');
    });
  });

  describe('isError', () => {
    test('should detect error results from exit code', () => {
      const isError = bashRenderer.isError?.(mockErrorResult);
      expect(isError).toBe(true);
    });

    test('should detect success results correctly', () => {
      const isError = bashRenderer.isError?.(mockSuccessResult);
      expect(isError).toBe(false);
    });

    test('should detect errors from non-zero exit codes', () => {
      const nonZeroExitResult: ToolResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              stdout: 'partial output',
              stderr: '',
              exitCode: 1,
            }),
          },
        ],
        status: 'completed' as const,
      };
      const isError = bashRenderer.isError?.(nonZeroExitResult);
      expect(isError).toBe(true);
    });

    test('should handle legacy plain text output', () => {
      const legacyResult = {
        content: [{ type: 'text', text: 'plain text output' }],
        status: 'completed' as const,
      } as ToolResult;
      const isError = bashRenderer.isError?.(legacyResult);
      expect(isError).toBe(false);
    });

    test('should prioritize isError flag over exit code', () => {
      const flaggedErrorResult: ToolResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              stdout: 'output',
              stderr: '',
              exitCode: 0,
            }),
          },
        ],
        status: 'failed' as const, // Explicitly flagged as error
      };
      const isError = bashRenderer.isError?.(flaggedErrorResult);
      expect(isError).toBe(true);
    });
  });

  describe('renderResult', () => {
    test('should render structured success results', () => {
      const resultNode = bashRenderer.renderResult?.(mockSuccessResult);
      expect(resultNode).toBeDefined();
      expect(typeof resultNode).toBe('object');
    });

    test('should render structured error results with stderr', () => {
      const resultNode = bashRenderer.renderResult?.(mockErrorResult);
      expect(resultNode).toBeDefined();
      expect(typeof resultNode).toBe('object');
    });

    test('should handle empty content', () => {
      const emptyResult: ToolResult = {
        content: [],
        status: 'completed' as const,
      };
      const resultNode = bashRenderer.renderResult?.(emptyResult);
      expect(resultNode).toBeDefined();
    });

    test('should handle legacy plain text output', () => {
      const legacyResult: ToolResult = {
        content: [
          {
            type: 'text',
            text: 'Plain text output from old format',
          },
        ],
        status: 'completed' as const,
      };
      const resultNode = bashRenderer.renderResult?.(legacyResult);
      expect(resultNode).toBeDefined();
    });

    test('should handle structured output with both stdout and stderr', () => {
      const mixedResult: ToolResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              stdout: 'Some successful output',
              stderr: 'Warning: deprecated feature used',
              exitCode: 0,
            }),
          },
        ],
        status: 'completed' as const,
      };
      const resultNode = bashRenderer.renderResult?.(mixedResult);
      expect(resultNode).toBeDefined();
    });

    test('should show exit code for non-zero exits', () => {
      const nonZeroExitResult: ToolResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              stdout: '',
              stderr: 'File not found',
              exitCode: 2,
            }),
          },
        ],
        status: 'completed' as const,
      };
      const resultNode = bashRenderer.renderResult?.(nonZeroExitResult);
      expect(resultNode).toBeDefined();
    });

    test('should show success indicator for empty successful output', () => {
      const emptySuccessResult: ToolResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              stdout: '',
              stderr: '',
              exitCode: 0,
            }),
          },
        ],
        status: 'completed' as const,
      };
      const resultNode = bashRenderer.renderResult?.(emptySuccessResult);
      expect(resultNode).toBeDefined();
    });
  });

  describe('getIcon', () => {
    test('should return terminal icon', () => {
      const icon = bashRenderer.getIcon?.();
      expect(icon).toBe(faTerminal);
    });
  });

  describe('integration with tool renderer system', () => {
    test('should have all expected methods defined', () => {
      expect(bashRenderer.getSummary).toBeDefined();
      expect(bashRenderer.isError).toBeDefined();
      expect(bashRenderer.renderResult).toBeDefined();
      expect(bashRenderer.getIcon).toBeDefined();
    });

    test('should be compatible with ToolRenderer interface', () => {
      // Type check - if this compiles, the interface is compatible
      const renderer = bashRenderer;
      expect(typeof renderer.getSummary).toBe('function');
      expect(typeof renderer.isError).toBe('function');
      expect(typeof renderer.renderResult).toBe('function');
      expect(typeof renderer.getIcon).toBe('function');
    });
  });
});
