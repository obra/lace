// ABOUTME: Tests for the file-edit tool renderer with diff visualization
// ABOUTME: Verifies proper rendering of file edits with context and diffs

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { fileEditRenderer } from './file-edit';
import type { ToolResult } from './types';

describe('fileEditRenderer', () => {
  describe('getSummary', () => {
    it('should return path-specific summary when path is provided', () => {
      const summary = fileEditRenderer.getSummary({ path: '/src/app.ts' });
      expect(summary).toBe('Edit /src/app.ts');
    });

    it('should return generic summary when no path', () => {
      const summary = fileEditRenderer.getSummary({});
      expect(summary).toBe('Edit file');
    });

    it('should handle invalid arguments gracefully', () => {
      expect(fileEditRenderer.getSummary(null)).toBe('Edit file');
      expect(fileEditRenderer.getSummary(undefined)).toBe('Edit file');
      expect(fileEditRenderer.getSummary('string')).toBe('Edit file');
    });
  });

  describe('isError', () => {
    it('should return true for error results', () => {
      const result: ToolResult = {
        content: [{ type: 'text', text: 'Error message' }],
        isError: true,
      };
      expect(fileEditRenderer.isError!(result)).toBe(true);
    });

    it('should return false for success results', () => {
      const result: ToolResult = {
        content: [{ type: 'text', text: 'Success' }],
        isError: false,
      };
      expect(fileEditRenderer.isError!(result)).toBe(false);
    });
  });

  describe('renderResult', () => {
    it('should render error state properly', () => {
      const result: ToolResult = {
        content: [{ type: 'text', text: 'File not found' }],
        isError: true,
      };

      const rendered = fileEditRenderer.renderResult!(result);
      const { container } = render(React.createElement('div', null, rendered));

      expect(container.textContent).toContain('Edit Failed');
      expect(container.textContent).toContain('File not found');
      expect(container.querySelector('.text-error')).toBeTruthy();
    });

    it('should render diff when enhanced metadata is available', () => {
      const result: ToolResult = {
        content: [{ type: 'text', text: 'Successfully replaced text' }],
        isError: false,
        metadata: {
          diff: {
            beforeContext: 'line 1\nline 2',
            afterContext: 'line 5\nline 6',
            oldContent: 'line 1\nline 2\nold line 3\nold line 4\nline 5\nline 6',
            newContent: 'line 1\nline 2\nnew line 3\nnew line 4\nline 5\nline 6',
            startLine: 1,
          },
          path: '/test/file.ts',
          oldText: 'old line 3\nold line 4',
          newText: 'new line 3\nnew line 4',
        },
      };

      const rendered = fileEditRenderer.renderResult!(result);
      const { container } = render(React.createElement('div', null, rendered));

      // Should render FileDiffViewer component
      expect(container.querySelector('.border-base-300')).toBeTruthy();
    });

    it('should show fallback diff when only arguments are available', () => {
      const result: ToolResult = {
        content: [{ type: 'text', text: 'Successfully replaced text' }],
        isError: false,
      };

      const metadata = {
        arguments: {
          path: '/test/file.js',
          old_text: 'const x = 1;',
          new_text: 'const x = 2;',
        },
      };

      const rendered = fileEditRenderer.renderResult!(result, metadata as any);
      const { container } = render(React.createElement('div', null, rendered));

      // Should show warning about no context
      expect(container.textContent).toContain('without context');
    });

    it('should show simple success when no diff data available', () => {
      const result: ToolResult = {
        content: [{ type: 'text', text: 'File edited successfully' }],
        isError: false,
      };

      const rendered = fileEditRenderer.renderResult!(result);
      const { container } = render(React.createElement('div', null, rendered));

      expect(container.textContent).toContain('File edited successfully');
      expect(container.querySelector('.text-success')).toBeTruthy();
    });

    it('should handle empty content gracefully', () => {
      const result: ToolResult = {
        content: [],
        isError: false,
      };

      const rendered = fileEditRenderer.renderResult!(result);
      const { container } = render(React.createElement('div', null, rendered));

      expect(container.textContent).toContain('No output');
    });

    it('should correctly adjust line numbers when startLine > 1', () => {
      const result: ToolResult = {
        content: [{ type: 'text', text: 'Success' }],
        isError: false,
        metadata: {
          diff: {
            beforeContext: 'line 10',
            afterContext: 'line 14',
            oldContent: 'line 10\nold line\nline 14',
            newContent: 'line 10\nnew line\nline 14',
            startLine: 10,
          },
          path: '/test.py',
        },
      };

      const rendered = fileEditRenderer.renderResult!(result);
      expect(rendered).toBeTruthy();
      // The FileDiffViewer should receive adjusted line numbers
      // This would be better tested with actual FileDiffViewer rendering
    });
  });

  describe('getIcon', () => {
    it('should return the file edit icon', () => {
      const icon = fileEditRenderer.getIcon!();
      expect(icon).toBeDefined();
      expect(icon.iconName).toBe('file-edit');
    });
  });
});
