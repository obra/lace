// ABOUTME: Tests for file reading tool with range support
// ABOUTME: Validates file reading, line ranges, and error handling

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { FileReadTool } from '~/tools/implementations/file-read';

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
      expect(tool.description).toContain('100');
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
    it('should read entire file when no range specified', async () => {
      const result = await tool.execute(
        { path: testFile },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('completed');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe(testContent);
    });

    it('should read specific line range', async () => {
      const result = await tool.execute(
        {
          path: testFile,
          startLine: 2,
          endLine: 4,
        },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe('Line 2\nLine 3\nLine 4');
    });

    it('should read from start line to end of file', async () => {
      const result = await tool.execute(
        {
          path: testFile,
          startLine: 3,
        },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe('Line 3\nLine 4\nLine 5');
    });

    it('should read from beginning to end line', async () => {
      const result = await tool.execute(
        {
          path: testFile,
          endLine: 2,
        },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe('Line 1\nLine 2');
    });
  });

  describe('error handling', () => {
    it('should handle missing path parameter', async () => {
      const result = await tool.execute({}, { signal: new AbortController().signal });

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('path: Required');
    });

    it('should handle empty path parameter', async () => {
      const result = await tool.execute({ path: '' }, { signal: new AbortController().signal });

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('Validation failed');
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
      expect(result.content[0].text).toBe('Line 3\nLine 4\nLine 5');
    });

    it('should reject whole-file read for files larger than 32KB', async () => {
      // Create a large file (>32KB)
      const largeContent = 'x'.repeat(33 * 1024); // 33KB
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
      expect(result.content[0].text).toContain('33 KB');
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

    it('should reject ranged reads larger than 100 lines', async () => {
      const result = await tool.execute(
        {
          path: testFile,
          startLine: 1,
          endLine: 101, // 101 lines = too large
        },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('Range too large (101 lines)');
      expect(result.content[0].text).toContain('Use smaller ranges (max 100 lines per read)');
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
      expect(result.content[0].text).toBe('');
    });

    it('should handle single line file', async () => {
      const singleLineFile = join(testDir, 'single.txt');
      await writeFile(singleLineFile, 'Only line');

      const result = await tool.execute(
        { path: singleLineFile },
        { signal: new AbortController().signal }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe('Only line');
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
      expect(result.content[0].text).toBe('Content from relative path');
    });

    it('should use absolute paths directly even when working directory is provided', async () => {
      const result = await tool.execute(
        { path: testFile }, // absolute path
        { signal: new AbortController().signal, workingDirectory: '/some/other/dir' }
      );

      expect(result.status).toBe('completed');
      expect(result.content[0].text).toBe(testContent);
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
        expect(result.content[0].text).toBe('CWD test content');
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
