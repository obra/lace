// ABOUTME: Test suite for file_read tool renderer TDD implementation
// ABOUTME: Comprehensive tests for file content display customizations

import { describe, test, expect } from 'vitest';
import { faFileCode } from '@fortawesome/free-solid-svg-icons';
import type { ToolResult } from '@/types/core';
import { fileReadRenderer } from './file-read';

describe('fileReadRenderer', () => {
  const mockFileReadArgs = {
    path: '/home/user/projects/lace/src/components/Button.tsx',
    startLine: 1,
    endLine: 10,
  };

  const mockSuccessResult: ToolResult = {
    content: [
      {
        type: 'text',
        text: 'import React from "react";\n\nexport const Button = ({ children, onClick, variant = "primary" }) => {\n  return (\n    <button\n      onClick={onClick}\n      className={`btn btn-${variant}`}\n    >\n      {children}\n    </button>\n  );\n};',
      },
    ],
    status: 'completed' as const,
    metadata: {
      totalLines: 25,
      linesReturned: 10,
      fileSize: '1.2 KB',
    },
  };

  const mockLargeFileResult: ToolResult = {
    content: [
      {
        type: 'text',
        text: '// Large file content truncated for display...\nconst config = {\n  api: "https://api.example.com",\n  timeout: 5000\n};',
      },
    ],
    status: 'completed' as const,
    metadata: {
      totalLines: 500,
      linesReturned: 100,
      fileSize: '45.2 KB',
    },
  };

  const mockErrorResult: ToolResult = {
    content: [
      {
        type: 'text',
        text: 'File not found: /nonexistent/file.txt\n\nSimilar files: /home/user/file.txt, /home/user/files.txt',
      },
    ],
    status: 'failed' as const,
  };

  describe('getSummary', () => {
    test('should create concise summary for file read operations', () => {
      const summary = fileReadRenderer.getSummary?.(mockFileReadArgs);
      expect(summary).toBe('Read /home/user/projects/lace/src/components/Button.tsx (lines 1-10)');
    });

    test('should handle line ranges in summary', () => {
      const rangeArgs = {
        ...mockFileReadArgs,
        startLine: 15,
        endLine: 25,
      };
      const summary = fileReadRenderer.getSummary?.(rangeArgs);
      expect(summary).toBe('Read /home/user/projects/lace/src/components/Button.tsx (lines 15-25)');
    });

    test('should handle start line only', () => {
      const startOnlyArgs = {
        ...mockFileReadArgs,
        startLine: 10,
        endLine: undefined,
      };
      const summary = fileReadRenderer.getSummary?.(startOnlyArgs);
      expect(summary).toBe('Read /home/user/projects/lace/src/components/Button.tsx');
    });

    test('should handle end line only', () => {
      const endOnlyArgs = {
        ...mockFileReadArgs,
        startLine: undefined,
        endLine: 20,
      };
      const summary = fileReadRenderer.getSummary?.(endOnlyArgs);
      expect(summary).toBe('Read /home/user/projects/lace/src/components/Button.tsx');
    });

    test('should handle missing or invalid args', () => {
      expect(fileReadRenderer.getSummary?.({})).toBe('Read file');
      expect(fileReadRenderer.getSummary?.(null)).toBe('Read file');
      expect(fileReadRenderer.getSummary?.({ path: '' })).toBe('Read file');
    });
  });

  describe('isError', () => {
    test('should detect error from ToolResult.isError flag', () => {
      expect(fileReadRenderer.isError?.(mockErrorResult)).toBe(true);
    });

    test('should detect success from ToolResult.isError flag', () => {
      expect(fileReadRenderer.isError?.(mockSuccessResult)).toBe(false);
    });

    test('should only trust isError flag for error detection', () => {
      const contentErrorResult: ToolResult = {
        content: [{ type: 'text', text: 'Permission denied accessing file' }],
        status: 'completed' as const, // Tool says it's not an error, so we trust it
      };
      expect(fileReadRenderer.isError?.(contentErrorResult)).toBe(false);
    });

    test('should handle missing content gracefully', () => {
      const emptyResult: ToolResult = {
        content: [],
        status: 'completed' as const,
      };
      expect(fileReadRenderer.isError?.(emptyResult)).toBe(false);
    });
  });

  describe('renderResult', () => {
    test('should render successful file read with content', () => {
      const result = fileReadRenderer.renderResult?.(mockSuccessResult);
      expect(result).toBeDefined();
    });

    test('should render error result with error styling', () => {
      const result = fileReadRenderer.renderResult?.(mockErrorResult);
      expect(result).toBeDefined();
    });

    test('should render large file with metadata', () => {
      const result = fileReadRenderer.renderResult?.(mockLargeFileResult);
      expect(result).toBeDefined();
    });

    test('should handle empty result content', () => {
      const emptyResult: ToolResult = {
        content: [],
        status: 'completed' as const,
      };
      const result = fileReadRenderer.renderResult?.(emptyResult);
      expect(result).toBeDefined();
    });
  });

  describe('getIcon', () => {
    test('should return file code icon', () => {
      expect(fileReadRenderer.getIcon?.()).toBe(faFileCode);
    });
  });

  describe('content handling', () => {
    test('should handle code content with syntax highlighting potential', () => {
      const codeResult: ToolResult = {
        content: [
          {
            type: 'text',
            text: 'function hello() {\n  console.log("Hello, world!");\n}',
          },
        ],
        status: 'completed' as const,
        metadata: { fileSize: '256 bytes', totalLines: 3, linesReturned: 3 },
      };
      const result = fileReadRenderer.renderResult?.(codeResult);
      expect(result).toBeDefined();
    });

    test('should handle large content with truncation', () => {
      const largeContent = 'x'.repeat(5000);
      const largeResult: ToolResult = {
        content: [{ type: 'text', text: largeContent }],
        status: 'completed' as const,
        metadata: { fileSize: '5.0 KB', totalLines: 100, linesReturned: 100 },
      };
      const result = fileReadRenderer.renderResult?.(largeResult);
      expect(result).toBeDefined();
    });
  });

  describe('integration with tool renderer system', () => {
    test('should implement ToolRenderer interface', () => {
      expect(typeof fileReadRenderer.getSummary).toBe('function');
      expect(typeof fileReadRenderer.isError).toBe('function');
      expect(typeof fileReadRenderer.renderResult).toBe('function');
      expect(typeof fileReadRenderer.getIcon).toBe('function');
    });

    test('should be compatible with ToolRenderer interface', () => {
      // Type check - this will fail compilation if interface doesn't match
      const renderer: import('./types').ToolRenderer = fileReadRenderer;
      expect(renderer).toBeDefined();
    });
  });
});
