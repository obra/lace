// ABOUTME: Tests for tool approval preview utilities
// ABOUTME: Verifies partial diff generation and preview result creation for different tool types

import { describe, it, expect } from 'vitest';
import {
  createPartialDiff,
  createPreviewResult,
  shouldShowPartialDiff,
} from './tool-approval-preview';

describe('tool-approval-preview', () => {
  describe('createPartialDiff', () => {
    it('should create partial diff for file_edit with single edit', () => {
      const args = {
        path: '/src/app.ts',
        old_string: 'const oldValue = 123;',
        new_string: 'const newValue = 456;',
      };

      const diff = createPartialDiff('file_edit', args);

      expect(diff).toBeTruthy();
      expect(diff?.oldFilePath).toBe('/src/app.ts');
      expect(diff?.newFilePath).toBe('/src/app.ts');
      expect(diff?.chunks).toHaveLength(1);
      expect(diff?.chunks[0].lines).toHaveLength(2);
      expect(diff?.chunks[0].lines[0].type).toBe('removed');
      expect(diff?.chunks[0].lines[0].content).toBe('const oldValue = 123;');
      expect(diff?.chunks[0].lines[1].type).toBe('added');
      expect(diff?.chunks[0].lines[1].content).toBe('const newValue = 456;');
    });

    it('should create partial diff for file_edit with multi-edit format', () => {
      const args = {
        path: '/src/app.ts',
        edits: [
          { old_text: 'console.log("old");', new_text: 'console.log("new");' },
          { old_text: 'let x = 1;', new_text: 'let x = 2;' },
        ],
      };

      const diff = createPartialDiff('file_edit', args);

      expect(diff).toBeTruthy();
      expect(diff?.chunks).toHaveLength(2);
      expect(diff?.chunks[0].lines[0].content).toBe('console.log("old");');
      expect(diff?.chunks[0].lines[1].content).toBe('console.log("new");');
      expect(diff?.chunks[1].lines[0].content).toBe('let x = 1;');
      expect(diff?.chunks[1].lines[1].content).toBe('let x = 2;');
    });

    it('should handle multiline edits correctly', () => {
      const args = {
        path: '/src/app.ts',
        old_string: 'function oldFunc() {\n  return "old";\n}',
        new_string: 'function newFunc() {\n  return "new";\n  console.log("added");\n}',
      };

      const diff = createPartialDiff('file_edit', args);

      expect(diff).toBeTruthy();
      expect(diff?.chunks).toHaveLength(1);

      const lines = diff?.chunks[0].lines || [];
      const removedLines = lines.filter((l) => l.type === 'removed');
      const addedLines = lines.filter((l) => l.type === 'added');

      expect(removedLines).toHaveLength(3); // 3 lines in old function
      expect(addedLines).toHaveLength(4); // 4 lines in new function
    });

    it('should return null for non-file_edit tools', () => {
      const diff = createPartialDiff('bash', { command: 'ls -la' });
      expect(diff).toBeNull();
    });

    it('should return null for file_edit with no edits', () => {
      const diff = createPartialDiff('file_edit', { path: '/src/app.ts' });
      expect(diff).toBeNull();
    });
  });

  describe('createPreviewResult', () => {
    it('should create preview result for file_write', () => {
      const args = { path: '/src/new-file.ts', content: 'console.log("hello");' };
      const result = createPreviewResult('file_write', args);

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe('Would write to /src/new-file.ts');
      expect(result.metadata?.isPreview).toBe(true);
      expect(result.metadata?.arguments).toBe(args);
    });

    it('should create preview result for file_edit', () => {
      const args = {
        path: '/src/app.ts',
        edits: [{ old_text: 'old', new_text: 'new' }],
      };
      const result = createPreviewResult('file_edit', args);

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe('Would apply 1 edit to /src/app.ts');
      expect(result.metadata?.isPreview).toBe(true);
    });

    it('should create preview result for bash', () => {
      const args = { command: 'npm test', description: 'Run tests' };
      const result = createPreviewResult('bash', args);

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe('Would execute command: npm test');
      expect(result.metadata?.isPreview).toBe(true);
    });

    it('should create default preview result for unknown tools', () => {
      const result = createPreviewResult('unknown_tool', {});

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe('Would execute unknown_tool');
      expect(result.metadata?.isPreview).toBe(true);
    });
  });

  describe('shouldShowPartialDiff', () => {
    it('should return true only for file_edit', () => {
      expect(shouldShowPartialDiff('file_edit')).toBe(true);
      expect(shouldShowPartialDiff('FILE_EDIT')).toBe(true); // Case insensitive
    });

    it('should return false for other tools', () => {
      expect(shouldShowPartialDiff('file_write')).toBe(false);
      expect(shouldShowPartialDiff('bash')).toBe(false);
      expect(shouldShowPartialDiff('file_read')).toBe(false);
      expect(shouldShowPartialDiff('unknown_tool')).toBe(false);
    });
  });
});
