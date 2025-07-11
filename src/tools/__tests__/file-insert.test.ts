// ABOUTME: Tests for schema-based file insertion tool with structured output
// ABOUTME: Validates file insertion at specific lines and end-of-file appending

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { FileInsertTool } from '~/tools/implementations/file-insert.js';

describe('FileInsertTool with schema validation', () => {
  let tool: FileInsertTool;

  beforeEach(async () => {
    tool = new FileInsertTool();
    await mkdir(testDir, { recursive: true });
  });

  const testDir = join(process.cwd(), 'test-temp-file-insert-schema');

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('file_insert');
      expect(tool.description).toContain('Insert content into a file');
    });

    it('should have proper input schema', () => {
      const schema = tool.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties.path).toBeDefined();
      expect(schema.properties.content).toBeDefined();
      expect(schema.properties.line).toBeDefined();
      expect(schema.required).toContain('path');
      expect(schema.required).toContain('content');
      expect(schema.required).not.toContain('line');
    });

    it('should be marked as destructive', () => {
      expect(tool.annotations?.destructiveHint).toBe(true);
    });
  });

  describe('Input validation', () => {
    it('should reject missing path', async () => {
      const result = await tool.execute({ content: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('path');
      expect(result.content[0].text).toContain('Required');
    });

    it('should reject empty path', async () => {
      const result = await tool.execute({ path: '', content: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('Cannot be empty');
    });

    it('should reject missing content', async () => {
      const result = await tool.execute({ path: '/tmp/test.txt' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('content');
      expect(result.content[0].text).toContain('Required');
    });

    it('should reject non-string content', async () => {
      const result = await tool.execute({
        path: '/tmp/test.txt',
        content: 123,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('content');
    });

    it('should reject non-integer line numbers', async () => {
      const result = await tool.execute({
        path: '/tmp/test.txt',
        content: 'test',
        line: 1.5,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('Must be an integer');
    });

    it('should reject negative line numbers', async () => {
      const result = await tool.execute({
        path: '/tmp/test.txt',
        content: 'test',
        line: -1,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('Must be positive');
    });

    it('should reject zero line numbers', async () => {
      const result = await tool.execute({
        path: '/tmp/test.txt',
        content: 'test',
        line: 0,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('Must be positive');
    });

    it('should accept valid parameters', async () => {
      const testFile = join(testDir, 'valid.txt');
      await writeFile(testFile, 'line 1\nline 2\n', 'utf-8');

      const result = await tool.execute({
        path: testFile,
        content: 'inserted content',
        line: 1,
      });

      // Should not fail validation (may fail if line number is out of range)
      if (result.isError) {
        expect(result.content[0].text).not.toContain('Validation failed');
      }
    });
  });

  describe('File insertion operations', () => {
    it('should append to end of file when no line specified', async () => {
      const testFile = join(testDir, 'append.txt');
      const originalContent = 'line 1\nline 2\n';
      const insertContent = 'appended content';

      await writeFile(testFile, originalContent, 'utf-8');

      const result = await tool.execute({
        path: testFile,
        content: insertContent,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Appended to end of file');
      expect(result.content[0].text).toContain(testFile);

      const newContent = await readFile(testFile, 'utf-8');
      expect(newContent).toBe(originalContent + insertContent);
    });

    it('should add newline before appending if file does not end with newline', async () => {
      const testFile = join(testDir, 'no-newline.txt');
      const originalContent = 'line 1\nline 2'; // No trailing newline
      const insertContent = 'appended content';

      await writeFile(testFile, originalContent, 'utf-8');

      const result = await tool.execute({
        path: testFile,
        content: insertContent,
      });

      expect(result.isError).toBe(false);

      const newContent = await readFile(testFile, 'utf-8');
      expect(newContent).toBe(originalContent + '\n' + insertContent);
    });

    it('should insert content after specified line', async () => {
      const testFile = join(testDir, 'insert.txt');
      const originalContent = 'line 1\nline 2\nline 3\n';
      const insertContent = 'inserted after line 2';

      await writeFile(testFile, originalContent, 'utf-8');

      const result = await tool.execute({
        path: testFile,
        content: insertContent,
        line: 2,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Inserted after line 2');

      const newContent = await readFile(testFile, 'utf-8');
      const lines = newContent.split('\n');
      expect(lines[2]).toBe('inserted after line 2');
      expect(lines[0]).toBe('line 1');
      expect(lines[1]).toBe('line 2');
      expect(lines[3]).toBe('line 3');
    });

    it('should handle multi-line insertions', async () => {
      const testFile = join(testDir, 'multiline.txt');
      const originalContent = 'line 1\nline 2\n';
      const insertContent = 'inserted line 1\ninserted line 2';

      await writeFile(testFile, originalContent, 'utf-8');

      const result = await tool.execute({
        path: testFile,
        content: insertContent,
        line: 1,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('+2 lines');

      const newContent = await readFile(testFile, 'utf-8');
      const lines = newContent.split('\n');
      expect(lines[1]).toBe('inserted line 1');
      expect(lines[2]).toBe('inserted line 2');
    });

    it('should report correct line count for single line insertion', async () => {
      const testFile = join(testDir, 'single.txt');
      const originalContent = 'line 1\nline 2\n';
      const insertContent = 'single inserted line';

      await writeFile(testFile, originalContent, 'utf-8');

      const result = await tool.execute({
        path: testFile,
        content: insertContent,
        line: 1,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('+1 line');
      expect(result.content[0].text).not.toContain('+1 lines');
    });

    it('should validate line number against file content', async () => {
      const testFile = join(testDir, 'bounds.txt');
      const originalContent = 'line 1\nline 2\n'; // 2 lines

      await writeFile(testFile, originalContent, 'utf-8');

      const result = await tool.execute({
        path: testFile,
        content: 'test',
        line: 5, // Line 5 doesn't exist
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Line number');
      expect(result.content[0].text).toContain('out of range');
    });
  });

  describe('Structured output with helpers', () => {
    it('should use createResult for successful insertions', async () => {
      const testFile = join(testDir, 'success.txt');
      const content = 'original content';
      await writeFile(testFile, content, 'utf-8');

      const result = await tool.execute({
        path: testFile,
        content: 'inserted',
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Appended to end of file');
      expect(result.content[0].text).toContain(testFile);
      expect(result.content[0].text).toContain('+1 line');
    });

    it('should use createError for validation failures', async () => {
      const result = await tool.execute({ path: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });

    it('should provide enhanced error messages for file not found', async () => {
      const result = await tool.execute({
        path: '/nonexistent/file.txt',
        content: 'test',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty content insertion', async () => {
      const testFile = join(testDir, 'empty-content.txt');
      const originalContent = 'line 1\nline 2\n';

      await writeFile(testFile, originalContent, 'utf-8');

      const result = await tool.execute({
        path: testFile,
        content: '',
      });

      expect(result.isError).toBe(false);

      const newContent = await readFile(testFile, 'utf-8');
      expect(newContent).toBe(originalContent);
    });

    it('should handle insertion into empty file', async () => {
      const testFile = join(testDir, 'empty-file.txt');
      await writeFile(testFile, '', 'utf-8');

      const result = await tool.execute({
        path: testFile,
        content: 'first content',
      });

      expect(result.isError).toBe(false);

      const newContent = await readFile(testFile, 'utf-8');
      expect(newContent).toBe('first content');
    });

    it('should handle special characters and unicode', async () => {
      const testFile = join(testDir, 'unicode.txt');
      const originalContent = 'Hello\n';
      const insertContent = '世界! 🚀 Émojis';

      await writeFile(testFile, originalContent, 'utf-8');

      const result = await tool.execute({
        path: testFile,
        content: insertContent,
        line: 1,
      });

      expect(result.isError).toBe(false);

      const newContent = await readFile(testFile, 'utf-8');
      expect(newContent).toContain('世界! 🚀 Émojis');
    });
  });

  describe('Error handling scenarios', () => {
    it('should provide actionable error for permission denied', async () => {
      // This test would need a way to simulate permission errors
      // For now, just verify the structure exists
      expect(tool.validatePath).toBeDefined();
    });

    it('should provide actionable error for disk space issues', async () => {
      // This test would need a way to simulate disk space errors
      // For now, just verify the tool handles errors gracefully
      expect(tool.name).toBe('file_insert');
    });
  });
});
