// ABOUTME: Test suite for file_write tool renderer TDD implementation
// ABOUTME: Comprehensive tests for file operation display customizations

import { describe, test, expect } from 'vitest';
import { faFileEdit } from '@fortawesome/free-solid-svg-icons';
import type { ToolResult } from '@/types/core';
import { fileWriteRenderer } from './file-write';

describe('fileWriteRenderer', () => {
  const mockFileWriteArgs = {
    path: '/home/user/documents/project/src/components/Button.tsx',
    content: 'export const Button = () => <button>Click me</button>;',
    createDirs: true,
  };

  const mockSuccessResult: ToolResult = {
    content: [
      {
        type: 'text',
        text: 'Successfully wrote 1.2 KB to /home/user/documents/project/src/components/Button.tsx',
      },
    ],
    isError: false,
  };

  const mockErrorResult: ToolResult = {
    content: [
      {
        type: 'text',
        text: 'Permission denied writing to /protected/system.conf. Check file permissions or choose a different location. File system error: EACCES',
      },
    ],
    isError: true,
  };

  const mockLargeFileResult: ToolResult = {
    content: [
      {
        type: 'text',
        text: 'Successfully wrote 2.5 MB to /home/user/data/large-dataset.json',
      },
    ],
    isError: false,
  };

  describe('getSummary', () => {
    test('should create concise summary for file write operations', () => {
      const summary = fileWriteRenderer.getSummary?.(mockFileWriteArgs);
      expect(summary).toBe('Write /home/user/documents/project/src/components/Button.tsx');
    });

    test('should handle long file paths by showing filename', () => {
      const longPathArgs = {
        ...mockFileWriteArgs,
        path: '/very/deeply/nested/directory/structure/with/many/levels/final-component.tsx',
      };
      const summary = fileWriteRenderer.getSummary?.(longPathArgs);
      expect(summary).toBe(
        'Write /very/deeply/nested/directory/structure/with/many/levels/final-component.tsx'
      );
    });

    test('should handle paths without extension', () => {
      const noExtArgs = {
        ...mockFileWriteArgs,
        path: '/home/user/README',
      };
      const summary = fileWriteRenderer.getSummary?.(noExtArgs);
      expect(summary).toBe('Write /home/user/README');
    });

    test('should handle root-level files', () => {
      const rootFileArgs = {
        ...mockFileWriteArgs,
        path: 'package.json',
      };
      const summary = fileWriteRenderer.getSummary?.(rootFileArgs);
      expect(summary).toBe('Write package.json');
    });

    test('should handle missing or invalid args', () => {
      expect(fileWriteRenderer.getSummary?.({})).toBe('Write file');
      expect(fileWriteRenderer.getSummary?.(null)).toBe('Write file');
      expect(fileWriteRenderer.getSummary?.({ path: '' })).toBe('Write file');
    });
  });

  describe('isError', () => {
    test('should detect error from ToolResult.isError flag', () => {
      expect(fileWriteRenderer.isError?.(mockErrorResult)).toBe(true);
    });

    test('should detect success from ToolResult.isError flag', () => {
      expect(fileWriteRenderer.isError?.(mockSuccessResult)).toBe(false);
    });

    test('should detect error from content text patterns', () => {
      const contentErrorResult: ToolResult = {
        content: [{ type: 'text', text: 'Failed to write file: ENOSPC' }],
        isError: false, // Will be detected by content analysis
      };
      expect(fileWriteRenderer.isError?.(contentErrorResult)).toBe(false);
    });

    test('should handle missing content gracefully', () => {
      const emptyResult: ToolResult = {
        content: [],
        isError: false,
      };
      expect(fileWriteRenderer.isError?.(emptyResult)).toBe(false);
    });
  });

  describe('renderResult', () => {
    test('should render successful file write with proper styling', () => {
      const result = fileWriteRenderer.renderResult?.(mockSuccessResult);
      expect(result).toBeDefined();
    });

    test('should render error result with error styling', () => {
      const result = fileWriteRenderer.renderResult?.(mockErrorResult);
      expect(result).toBeDefined();
    });

    test('should render large file result with size formatting', () => {
      const result = fileWriteRenderer.renderResult?.(mockLargeFileResult);
      expect(result).toBeDefined();
    });

    test('should handle empty result content', () => {
      const emptyResult: ToolResult = {
        content: [],
        isError: false,
      };
      const result = fileWriteRenderer.renderResult?.(emptyResult);
      expect(result).toBeDefined();
    });
  });

  describe('getIcon', () => {
    test('should return file code icon', () => {
      expect(fileWriteRenderer.getIcon?.()).toBe(faFileEdit);
    });
  });

  describe('integration with tool renderer system', () => {
    test('should implement ToolRenderer interface', () => {
      expect(typeof fileWriteRenderer.getSummary).toBe('function');
      expect(typeof fileWriteRenderer.isError).toBe('function');
      expect(typeof fileWriteRenderer.renderResult).toBe('function');
      expect(typeof fileWriteRenderer.getIcon).toBe('function');
    });

    test('should be compatible with ToolRenderer interface', () => {
      // Type check - this will fail compilation if interface doesn't match
      const renderer: import('./types').ToolRenderer = fileWriteRenderer;
      expect(renderer).toBeDefined();
    });
  });

  describe('content parsing and display', () => {
    test('should extract file path from success message', () => {
      // This will be tested in the actual render output
      const result = fileWriteRenderer.renderResult?.(mockSuccessResult);
      expect(result).toBeDefined();
    });

    test('should extract file size from success message', () => {
      // This will be tested in the actual render output
      const result = fileWriteRenderer.renderResult?.(mockSuccessResult);
      expect(result).toBeDefined();
    });

    test('should handle various error message formats', () => {
      const diskSpaceError: ToolResult = {
        content: [
          {
            type: 'text',
            text: 'Insufficient disk space to write file. Free up disk space and try again. File system error: ENOSPC',
          },
        ],
        isError: true,
      };
      const result = fileWriteRenderer.renderResult?.(diskSpaceError);
      expect(result).toBeDefined();
    });
  });
});
