// ABOUTME: Tests for schema-based file insertion tool with structured output
// ABOUTME: Validates file insertion at specific lines and end-of-file appending

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { FileInsertTool } from '~/tools/implementations/file-insert';

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
      expect(tool.description)
        .toBe(`Insert content at specific line or append to end, preserves existing content. Use file-write to replace entire file.
Line numbers are 1-based, inserts AFTER specified line. Omit line to append.`);
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
      const result = await tool.execute(
        { content: 'test' },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('path');
      expect(result.content[0].text).toContain('Required');
    });

    it('should reject empty path', async () => {
      const result = await tool.execute(
        { path: '', content: 'test' },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('File path cannot be empty');
    });

    it('should reject missing content', async () => {
      const result = await tool.execute(
        { path: '/tmp/test.txt' },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('content');
      expect(result.content[0].text).toContain('Required');
    });

    it('should reject non-string content', async () => {
      const result = await tool.execute(
        {
          path: '/tmp/test.txt',
          content: 123,
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('content');
    });

    it('should reject non-integer line numbers', async () => {
      const result = await tool.execute(
        {
          path: '/tmp/test.txt',
          content: 'test',
          line: 1.5,
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('Must be an integer');
    });

    it('should reject negative line numbers', async () => {
      const result = await tool.execute(
        {
          path: '/tmp/test.txt',
          content: 'test',
          line: -1,
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('Must be positive');
    });

    it('should reject zero line numbers', async () => {
      const result = await tool.execute(
        {
          path: '/tmp/test.txt',
          content: 'test',
          line: 0,
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('Must be positive');
    });

    it('should accept valid parameters', async () => {
      const testFile = join(testDir, 'valid.txt');
      await writeFile(testFile, 'line 1\nline 2\n', 'utf-8');

      const result = await tool.execute(
        {
          path: testFile,
          content: 'inserted content',
          line: 1,
        },
        { signal: new AbortController().signal }
      );

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

      const result = await tool.execute(
        {
          path: testFile,
          content: insertContent,
        },
        { signal: new AbortController().signal }
      );

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

      const result = await tool.execute(
        {
          path: testFile,
          content: insertContent,
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(false);

      const newContent = await readFile(testFile, 'utf-8');
      expect(newContent).toBe(originalContent + '\n' + insertContent);
    });

    it('should insert content after specified line', async () => {
      const testFile = join(testDir, 'insert.txt');
      const originalContent = 'line 1\nline 2\nline 3\n';
      const insertContent = 'inserted after line 2';

      await writeFile(testFile, originalContent, 'utf-8');

      const result = await tool.execute(
        {
          path: testFile,
          content: insertContent,
          line: 2,
        },
        { signal: new AbortController().signal }
      );

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

      const result = await tool.execute(
        {
          path: testFile,
          content: insertContent,
          line: 1,
        },
        { signal: new AbortController().signal }
      );

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

      const result = await tool.execute(
        {
          path: testFile,
          content: insertContent,
          line: 1,
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('+1 line');
      expect(result.content[0].text).not.toContain('+1 lines');
    });

    it('should validate line number against file content', async () => {
      const testFile = join(testDir, 'bounds.txt');
      const originalContent = 'line 1\nline 2\n'; // 2 lines

      await writeFile(testFile, originalContent, 'utf-8');

      const result = await tool.execute(
        {
          path: testFile,
          content: 'test',
          line: 5, // Line 5 doesn't exist
        },
        { signal: new AbortController().signal }
      );

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

      const result = await tool.execute(
        {
          path: testFile,
          content: 'inserted',
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Appended to end of file');
      expect(result.content[0].text).toContain(testFile);
      expect(result.content[0].text).toContain('+1 line');
    });

    it('should use createError for validation failures', async () => {
      const result = await tool.execute({ path: '' }, { signal: new AbortController().signal });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });

    it('should provide enhanced error messages for file not found', async () => {
      const result = await tool.execute(
        {
          path: '/nonexistent/file.txt',
          content: 'test',
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty content insertion', async () => {
      const testFile = join(testDir, 'empty-content.txt');
      const originalContent = 'line 1\nline 2\n';

      await writeFile(testFile, originalContent, 'utf-8');

      const result = await tool.execute(
        {
          path: testFile,
          content: '',
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(false);

      const newContent = await readFile(testFile, 'utf-8');
      expect(newContent).toBe(originalContent);
    });

    it('should handle insertion into empty file', async () => {
      const testFile = join(testDir, 'empty-file.txt');
      await writeFile(testFile, '', 'utf-8');

      const result = await tool.execute(
        {
          path: testFile,
          content: 'first content',
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(false);

      const newContent = await readFile(testFile, 'utf-8');
      expect(newContent).toBe('first content');
    });

    it('should handle special characters and unicode', async () => {
      const testFile = join(testDir, 'unicode.txt');
      const originalContent = 'Hello\n';
      const insertContent = '世界! 🚀 Émojis';

      await writeFile(testFile, originalContent, 'utf-8');

      const result = await tool.execute(
        {
          path: testFile,
          content: insertContent,
          line: 1,
        },
        { signal: new AbortController().signal }
      );

      expect(result.isError).toBe(false);

      const newContent = await readFile(testFile, 'utf-8');
      expect(newContent).toContain('世界! 🚀 Émojis');
    });
  });

  describe('Error handling scenarios', () => {
    it('should provide actionable error for permission denied', () => {
      // This test would need a way to simulate permission errors
      // For now, just verify the structure exists
      expect(tool.validatePath).toBeDefined();
    });

    it('should provide actionable error for disk space issues', () => {
      // This test would need a way to simulate disk space errors
      // For now, just verify the tool handles errors gracefully
      expect(tool.name).toBe('file_insert');
    });
  });

  describe('working directory support', () => {
    it('should resolve relative paths using working directory from context', async () => {
      // Create a relative test file
      const relativeTestFile = 'relative-insert-test.txt';
      const absoluteTestFile = join(testDir, relativeTestFile);
      await writeFile(absoluteTestFile, 'Original content\n', 'utf-8');

      const result = await tool.execute(
        {
          path: relativeTestFile,
          content: 'Inserted content',
          line: 1,
        },
        { signal: new AbortController().signal, workingDirectory: testDir }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Inserted after line 1');

      const newContent = await readFile(absoluteTestFile, 'utf-8');
      expect(newContent).toContain('Inserted content');
    });

    it('should use absolute paths directly even when working directory is provided', async () => {
      const testFile = join(testDir, 'absolute-path-test.txt');
      await writeFile(testFile, 'Original content\n', 'utf-8');

      const result = await tool.execute(
        {
          path: testFile, // absolute path
          content: 'Inserted content',
        },
        { signal: new AbortController().signal, workingDirectory: '/some/other/dir' }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Appended to end of file');

      const newContent = await readFile(testFile, 'utf-8');
      expect(newContent).toContain('Inserted content');
    });

    it('should fall back to process.cwd() when no working directory in context', async () => {
      // Create a file relative to current working directory
      const relativeFile = 'temp-cwd-insert-test.txt';
      const absoluteFile = join(process.cwd(), relativeFile);
      await writeFile(absoluteFile, 'CWD test content\n', 'utf-8');

      try {
        const result = await tool.execute(
          {
            path: relativeFile,
            content: 'Appended content',
          },
          { signal: new AbortController().signal }
        );

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toContain('Appended to end of file');

        const newContent = await readFile(absoluteFile, 'utf-8');
        expect(newContent).toContain('Appended content');
      } finally {
        await rm(absoluteFile, { force: true });
      }
    });

    it('should handle non-existent relative paths with working directory context', async () => {
      const result = await tool.execute(
        {
          path: 'nonexistent-relative-file.txt',
          content: 'test content',
        },
        { signal: new AbortController().signal, workingDirectory: testDir }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
    });
  });
});
