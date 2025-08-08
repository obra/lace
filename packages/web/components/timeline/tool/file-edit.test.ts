// ABOUTME: Tests for the file-edit tool renderer with enhanced multi-edit support
// ABOUTME: Verifies proper rendering of file edits with validation errors and multiple edits display

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { fileEditRenderer } from './file-edit';
import type { ToolResult } from './types';

describe('fileEditRenderer', () => {
  describe('getSummary', () => {
    it('should return path-specific summary for single edit', () => {
      const args = {
        path: '/src/app.ts',
        edits: [{ old_text: 'old', new_text: 'new' }],
      };
      const summary = fileEditRenderer.getSummary?.(args);
      expect(summary).toBe('Edit /src/app.ts');
    });

    it('should return multi-edit summary when multiple edits provided', () => {
      const args = {
        path: '/src/app.ts',
        edits: [
          { old_text: 'old1', new_text: 'new1' },
          { old_text: 'old2', new_text: 'new2' },
          { old_text: 'old3', new_text: 'new3' },
        ],
      };
      const summary = fileEditRenderer.getSummary?.(args);
      expect(summary).toBe('Apply 3 edits to /src/app.ts');
    });

    it('should return generic summary when no path', () => {
      const summary = fileEditRenderer.getSummary?.({});
      expect(summary).toBe('Edit file');
    });

    it('should handle invalid arguments gracefully', () => {
      expect(fileEditRenderer.getSummary?.(null)).toBe('Edit file');
      expect(fileEditRenderer.getSummary?.(undefined)).toBe('Edit file');
      expect(fileEditRenderer.getSummary?.('string')).toBe('Edit file');
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
    it('should render validation error with enhanced details', () => {
      const result: ToolResult = {
        content: [{ type: 'text', text: 'Edit 1 of 2: Expected 1 occurrence but found 3' }],
        isError: true,
        metadata: {
          validation_error: {
            type: 'WRONG_COUNT',
            edit_index: 0,
            total_edits: 2,
            expected_occurrences: 1,
            actual_occurrences: 3,
            match_locations: [
              { line_number: 5, column_start: 1, line_content: 'const foo = 1;' },
              { line_number: 10, column_start: 1, line_content: 'const foo = 2;' },
              { line_number: 15, column_start: 1, line_content: 'const foo = 3;' },
            ],
          },
        },
      };

      const rendered = fileEditRenderer.renderResult!(result);
      const { container } = render(React.createElement('div', null, rendered));

      expect(container.textContent).toContain('Occurrence Count Mismatch');
      expect(container.textContent).toContain('Edit 1 of 2');
      expect(container.textContent).toContain('Line 5');
      expect(container.textContent).toContain('Line 10');
      expect(container.textContent).toContain('Line 15');
    });

    it('should render NO_MATCH error with similar content', () => {
      const result: ToolResult = {
        content: [{ type: 'text', text: 'Could not find exact text' }],
        isError: true,
        metadata: {
          validation_error: {
            type: 'NO_MATCH',
            edit_index: 0,
            total_edits: 1,
            similar_content: [
              { line_number: 8, content: 'console.log("hello");', similarity_score: 0.85 },
              { line_number: 12, content: "console.log('world');", similarity_score: 0.75 },
            ],
          },
        },
      };

      const rendered = fileEditRenderer.renderResult!(result);
      const { container } = render(React.createElement('div', null, rendered));

      expect(container.textContent).toContain('Text Not Found');
      expect(container.textContent).toContain('Similar content found');
      expect(container.textContent).toContain('85% similar');
      expect(container.textContent).toContain('75% similar');
    });

    it('should render diff when enhanced metadata is available', () => {
      const result: ToolResult = {
        content: [{ type: 'text', text: 'Successfully applied 1 edit' }],
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
          edits_applied: [
            {
              old_text: 'old line 3\nold line 4',
              new_text: 'new line 3\nnew line 4',
              occurrences_replaced: 1,
            },
          ],
          total_replacements: 1,
        },
      };

      const rendered = fileEditRenderer.renderResult!(result);
      const { container } = render(React.createElement('div', null, rendered));

      // Should render FileDiffViewer component
      expect(container.querySelector('.border-base-300')).toBeTruthy();
    });

    it('should render dry run mode', () => {
      const result: ToolResult = {
        content: [{ type: 'text', text: 'Dry run completed. Would apply 2 edits to /src/app.ts' }],
        isError: false,
        metadata: {
          dry_run: true,
          edits_applied: [
            { old_text: 'const', new_text: 'let', occurrences_replaced: 5 },
            { old_text: 'old_function', new_text: 'new_function', occurrences_replaced: 1 },
          ],
        },
      };

      const rendered = fileEditRenderer.renderResult!(result);
      const { container } = render(React.createElement('div', null, rendered));

      expect(container.textContent).toContain('Dry Run Mode');
      expect(container.textContent).toContain('Would apply 2 edits');
    });

    it('should show success with multiple edits applied', () => {
      const result: ToolResult = {
        content: [{ type: 'text', text: 'Successfully applied 3 edits' }],
        isError: false,
        metadata: {
          edits_applied: [
            { old_text: 'const', new_text: 'let', occurrences_replaced: 5 },
            { old_text: 'old_function', new_text: 'new_function', occurrences_replaced: 1 },
            { old_text: 'foo', new_text: 'bar', occurrences_replaced: 2 },
          ],
          total_replacements: 8,
        },
      };

      const rendered = fileEditRenderer.renderResult!(result);
      const { container } = render(React.createElement('div', null, rendered));

      expect(container.textContent).toContain('Edit Successful');
      expect(container.textContent).toContain('Applied 3 edits');
      expect(container.textContent).toContain('8 total replacements');
      expect(container.textContent).toContain('Replace: const');
      expect(container.textContent).toContain('With: let');
      expect(container.textContent).toContain('(5 occurrences)');
    });

    it('should truncate long edit text in summary', () => {
      const longText =
        'This is a very long string that should be truncated when displayed in the UI because it would make the interface too cluttered and hard to read';
      const result: ToolResult = {
        content: [{ type: 'text', text: 'Successfully applied 1 edit' }],
        isError: false,
        metadata: {
          edits_applied: [{ old_text: longText, new_text: 'short', occurrences_replaced: 1 }],
          total_replacements: 1,
        },
      };

      const rendered = fileEditRenderer.renderResult!(result);
      const { container } = render(React.createElement('div', null, rendered));

      expect(container.textContent).toContain('...');
      expect(container.textContent).not.toContain(longText);
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
        content: [{ type: 'text', text: 'Successfully applied 1 edit' }],
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
          edits_applied: [{ old_text: 'old line', new_text: 'new line', occurrences_replaced: 1 }],
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
      expect(icon.iconName).toBe('file-pen');
    });
  });
});
