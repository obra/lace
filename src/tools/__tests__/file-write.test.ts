// ABOUTME: Tests for file writing tool with directory creation
// ABOUTME: Validates file writing, directory creation, and error handling

import { describe, it, expect, afterEach } from 'vitest';
import { readFile, rm, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { FileWriteTool } from '../implementations/file-write.js';

describe('FileWriteTool', () => {
  const tool = new FileWriteTool();
  const testDir = join(process.cwd(), 'test-temp-file-write');

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('file_write');
      expect(tool.description).toBe('Write content to a file, creating directories if needed');
      expect(tool.annotations?.destructiveHint).toBe(true);
    });

    it('should have correct input schema', () => {
      expect(tool.input_schema).toEqual({
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to write to' },
          content: { type: 'string', description: 'Content to write to the file' },
          createDirs: {
            type: 'boolean',
            description: 'Create parent directories if they do not exist (default: true)',
          },
        },
        required: ['path', 'content'],
      });
    });
  });

  describe('file writing', () => {
    it('should write content to new file', async () => {
      const testFile = join(testDir, 'test.txt');
      const content = 'Hello, world!';

      const result = await tool.executeTool({ path: testFile, content });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe(
        `Successfully wrote ${content.length} characters to ${testFile}`
      );

      const written = await readFile(testFile, 'utf-8');
      expect(written).toBe(content);
    });

    it('should overwrite existing file', async () => {
      const testFile = join(testDir, 'existing.txt');
      const originalContent = 'Original content';
      const newContent = 'New content';

      // First write
      await tool.executeTool({ path: testFile, content: originalContent });

      // Overwrite
      const result = await tool.executeTool({ path: testFile, content: newContent });

      expect(result.isError).toBe(false);

      const written = await readFile(testFile, 'utf-8');
      expect(written).toBe(newContent);
    });

    it('should create parent directories by default', async () => {
      const testFile = join(testDir, 'deep', 'nested', 'file.txt');
      const content = 'Deep file content';

      const result = await tool.executeTool({ path: testFile, content });

      expect(result.isError).toBe(false);

      const written = await readFile(testFile, 'utf-8');
      expect(written).toBe(content);

      // Verify directories were created
      const dirStats = await stat(dirname(testFile));
      expect(dirStats.isDirectory()).toBe(true);
    });

    it('should respect createDirs=false setting', async () => {
      const testFile = join(testDir, 'nonexistent', 'file.txt');
      const content = 'Content';

      const result = await tool.executeTool({
        path: testFile,
        content,
        createDirs: false,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('ENOENT');
    });
  });

  describe('error handling', () => {
    it('should handle missing path parameter', async () => {
      const result = await tool.executeTool({ content: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Path must be a non-empty string');
    });

    it('should handle empty path parameter', async () => {
      const result = await tool.executeTool({ path: '', content: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Path must be a non-empty string');
    });

    it('should handle missing content parameter', async () => {
      const result = await tool.executeTool({ path: '/tmp/test.txt' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Content must be a string');
    });

    it('should handle non-string content parameter', async () => {
      const result = await tool.executeTool({
        path: '/tmp/test.txt',
        content: 123,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Content must be a string');
    });
  });

  describe('edge cases', () => {
    it('should handle empty content', async () => {
      const testFile = join(testDir, 'empty.txt');
      const content = '';

      const result = await tool.executeTool({ path: testFile, content });

      expect(result.isError).toBe(false);

      const written = await readFile(testFile, 'utf-8');
      expect(written).toBe('');
    });

    it('should handle large content', async () => {
      const testFile = join(testDir, 'large.txt');
      const content = 'A'.repeat(10000);

      const result = await tool.executeTool({ path: testFile, content });

      expect(result.isError).toBe(false);

      const written = await readFile(testFile, 'utf-8');
      expect(written).toBe(content);
      expect(written.length).toBe(10000);
    });

    it('should handle special characters and unicode', async () => {
      const testFile = join(testDir, 'unicode.txt');
      const content = 'Hello 世界! 🚀 Émojis and spéciål chars';

      const result = await tool.executeTool({ path: testFile, content });

      expect(result.isError).toBe(false);

      const written = await readFile(testFile, 'utf-8');
      expect(written).toBe(content);
    });
  });
});
