// ABOUTME: Integration tests for file tool renderer registration
// ABOUTME: Validates file_write and file_read renderer registration and functionality

import { describe, test, expect } from 'vitest';
import { faFileCode, faFileEdit } from '@fortawesome/free-solid-svg-icons';
import { getToolRenderer } from './index';

describe('File Tool Renderer Integration', () => {
  const fileTools = ['file_write', 'file_read'];

  fileTools.forEach((toolName) => {
    describe(`${toolName} tool renderer`, () => {
      test('should be registered and return valid renderer', () => {
        const renderer = getToolRenderer(toolName);
        expect(renderer).toBeDefined();
        expect(typeof renderer).toBe('object');
      });

      test('should handle case-insensitive lookup', () => {
        const rendererLower = getToolRenderer(toolName.toLowerCase());
        const rendererUpper = getToolRenderer(toolName.toUpperCase());
        const rendererMixed = getToolRenderer(
          toolName.charAt(0).toUpperCase() + toolName.slice(1).toLowerCase()
        );

        expect(rendererLower).toEqual(rendererUpper);
        expect(rendererLower).toEqual(rendererMixed);
      });

      test('should have all required methods defined', () => {
        const renderer = getToolRenderer(toolName);
        expect(renderer.getSummary).toBeDefined();
        expect(renderer.isError).toBeDefined();
        expect(renderer.renderResult).toBeDefined();
        expect(renderer.getIcon).toBeDefined();
      });

      test('should have proper method return types', () => {
        const renderer = getToolRenderer(toolName);
        expect(typeof renderer.getSummary).toBe('function');
        expect(typeof renderer.isError).toBe('function');
        expect(typeof renderer.renderResult).toBe('function');
        expect(typeof renderer.getIcon).toBe('function');
      });
    });
  });

  describe('File tool renderer specifics', () => {
    test('file_write should return file edit icon', () => {
      expect(getToolRenderer('file_write').getIcon?.()).toBe(faFileEdit);
    });

    test('file_read should return file icon', () => {
      expect(getToolRenderer('file_read').getIcon?.()).toBe(faFileCode);
    });

    test('file_write should generate appropriate summaries', () => {
      const renderer = getToolRenderer('file_write');
      expect(renderer.getSummary?.({ path: '/home/user/test.txt' })).toBe(
        'Write /home/user/test.txt'
      );
      expect(renderer.getSummary?.({ path: 'README.md' })).toBe('Write README.md');
    });

    test('file_read should generate appropriate summaries', () => {
      const renderer = getToolRenderer('file_read');
      expect(renderer.getSummary?.({ path: '/home/user/test.txt' })).toBe(
        'Read /home/user/test.txt'
      );
      expect(renderer.getSummary?.({ path: 'README.md', startLine: 1, endLine: 10 })).toBe(
        'Read README.md'
      );
    });
  });

  describe('Error handling', () => {
    fileTools.forEach((toolName) => {
      test(`${toolName} should handle missing renderer gracefully`, () => {
        // This tests the fallback behavior
        const renderer = getToolRenderer('nonexistent_tool');
        expect(renderer).toEqual({});
      });

      test(`${toolName} should detect errors properly`, () => {
        const renderer = getToolRenderer(toolName);
        const errorResult = {
          content: [{ type: 'text' as const, text: 'Permission denied' }],
          isError: true,
        };
        expect(renderer.isError?.(errorResult)).toBe(true);
      });
    });
  });
});
