// ABOUTME: Tests for file reading tool with range support
// ABOUTME: Validates file reading, line ranges, and error handling

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { FileReadTool } from '~/tools/implementations/file_read';

describe('FileReadTool', () => {
  const tool = new FileReadTool();
  const testDir = join(process.cwd(), 'test-temp-file-read');
  const testFile = join(testDir, 'test.txt');
  const testContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(testFile, testContent);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('file_read');
      expect(tool.description).toContain('Read file contents');
      expect(tool.description).toContain('2000');
      expect(tool.description).toContain('ranges');
    });

    it('should have correct input schema', () => {
      const schema = tool.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties.path).toBeDefined();
      expect(schema.properties.startLine).toBeDefined();
      expect(schema.properties.endLine).toBeDefined();
      expect(schema.required).toContain('path');
      expect(schema.required).not.toContain('startLine');
      expect(schema.required).not.toContain('endLine');
    });
  });

  describe('file reading', () => {
    it('should read entire file when no range specified with line numbers', async () => {
      const result = await tool.execute(
        { path: testFile },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('completed');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe('1→Line 1\n2→Line 2\n3→Line 3\n4→Line 4\n5→Line 5');
    });

    it('should read specific line range with line numbers', async () => {
      const result = await tool.execute(
        {
          path: testFile,
          startLine: 2,
          endLine: 4,
        },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe('2→Line 2\n3→Line 3\n4→Line 4');
    });

    it('should read from start line to end of file with line numbers', async () => {
      const result = await tool.execute(
        {
          path: testFile,
          startLine: 3,
        },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe('3→Line 3\n4→Line 4\n5→Line 5');
    });

    it('should read from beginning to end line with line numbers', async () => {
      const result = await tool.execute(
        {
          path: testFile,
          endLine: 2,
        },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe('1→Line 1\n2→Line 2');
    });
  });

  describe('error handling', () => {
    it('should handle missing path parameter', async () => {
      const result = await tool.execute({}, { signal: new AbortController().signal });

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
      expect(result.content[0].text).toContain('Missing required: path');
    });

    it('should handle empty path parameter', async () => {
      const result = await tool.execute({ path: '' }, { signal: new AbortController().signal });

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('ValidationError');
      expect(result.content[0].text).toContain('File path cannot be empty');
    });

    it('should handle non-existent file', async () => {
      const result = await tool.execute(
        { path: '/non/existent/file.txt' },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('File not found');
    });

    it('should handle start line beyond file length', async () => {
      const result = await tool.execute(
        {
          path: testFile,
          startLine: 10,
        },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('Line 10 exceeds file length');
      expect(result.content[0].text).toContain('Use a line number between 1 and 5');
    });

    it('should handle end line beyond file length gracefully', async () => {
      const result = await tool.execute(
        {
          path: testFile,
          startLine: 3,
          endLine: 10,
        },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe('3→Line 3\n4→Line 4\n5→Line 5');
    });

    it('should reject whole-file read for files larger than 64KB', async () => {
      // Create a large file (>64KB)
      const largeContent = 'x'.repeat(65 * 1024); // 65KB
      const largeFile = join(testDir, 'large.txt');
      await writeFile(largeFile, largeContent);

      const result = await tool.execute(
        {
          path: largeFile,
        },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('File is too large');
      expect(result.content[0].text).toContain(
        'Use startLine and endLine parameters for ranged reads'
      );
      expect(result.content[0].text).toContain('65 KB');
    });

    it('should allow ranged reads for large files', async () => {
      // Create a large file with line numbers
      const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i + 1}`);
      const largeContent = lines.join('\n');
      const largeFile = join(testDir, 'large-lines.txt');
      await writeFile(largeFile, largeContent);

      const result = await tool.execute(
        {
          path: largeFile,
          startLine: 500,
          endLine: 505,
        },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('Line 500');
      expect(result.content[0].text).toContain('Line 505');
    });

    it('should return partial results for ranged reads larger than 2000 lines', async () => {
      // Create a file with 3000 lines
      const lines = Array.from({ length: 3000 }, (_, i) => `Line ${i + 1}`);
      const largeFile = join(testDir, 'large-3000.txt');
      await writeFile(largeFile, lines.join('\n'));

      const result = await tool.execute(
        {
          path: largeFile,
          startLine: 1,
          endLine: 2500, // Request 2500 lines, should get 2000
        },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('completed');
      expect(result.metadata?.truncated).toBe(true);
      expect(result.metadata?.warning).toContain('Requested 2500 lines');
      expect(result.metadata?.warning).toContain('limit is 2000');
      expect(result.metadata?.warning).toContain('Returned first 2000 lines');
      expect(result.metadata?.linesReturned).toBe(2000);
      expect(result.metadata?.requestedRange).toEqual({ start: 1, end: 2500 });
      expect(result.content[0].text).toContain('1→Line 1');
      expect(result.content[0].text).toContain('2000→Line 2000');
      expect(result.content[0].text).not.toContain('2001→Line 2001');
    });
  });

  describe('edge cases', () => {
    it('should handle empty file', async () => {
      const emptyFile = join(testDir, 'empty.txt');
      await writeFile(emptyFile, '');

      const result = await tool.execute(
        { path: emptyFile },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe('1→');
    });

    it('should handle single line file', async () => {
      const singleLineFile = join(testDir, 'single.txt');
      await writeFile(singleLineFile, 'Only line');

      const result = await tool.execute(
        { path: singleLineFile },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe('1→Only line');
    });
  });

  describe('working directory support', () => {
    it('should resolve relative paths using working directory from context', async () => {
      // Create a relative test file
      const relativeTestFile = 'relative-test.txt';
      const absoluteTestFile = join(testDir, relativeTestFile);
      await writeFile(absoluteTestFile, 'Content from relative path');

      const result = await tool.execute(
        { path: relativeTestFile },
        { signal: new AbortController().signal, workingDirectory: testDir }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe('1→Content from relative path');
    });

    it('should use absolute paths directly even when working directory is provided', async () => {
      const result = await tool.execute(
        { path: testFile }, // absolute path
        { signal: new AbortController().signal, workingDirectory: '/some/other/dir' }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe('1→Line 1\n2→Line 2\n3→Line 3\n4→Line 4\n5→Line 5');
    });

    it('should fall back to process.cwd() when no working directory in context', async () => {
      // Create a file relative to current working directory
      const relativeFile = 'temp-cwd-test.txt';
      const absoluteFile = join(process.cwd(), relativeFile);
      await writeFile(absoluteFile, 'CWD test content');

      try {
        const result = await tool.execute(
          { path: relativeFile },
          { signal: new AbortController().signal }
        );

        expect(result.status).toBe('completed');
        expect(result.content[0].text).toBe('1→CWD test content');
      } finally {
        await rm(absoluteFile, { force: true });
      }
    });

    it('should handle non-existent relative paths with working directory context', async () => {
      const result = await tool.execute(
        { path: 'non-existent-relative.txt' },
        { signal: new AbortController().signal, workingDirectory: testDir }
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('File not found');
      expect(result.content[0].text).toContain('non-existent-relative.txt');
    });
  });
});
