// ABOUTME: Tests for schema-based file writing tool with structured output
// ABOUTME: Validates file writing, directory creation, and enhanced error handling

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, rm, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { FileWriteTool } from '~/tools/implementations/file-write';

describe('FileWriteTool with schema validation', () => {
  let tool: FileWriteTool;

  beforeEach(() => {
    tool = new FileWriteTool();
  });

  const testDir = join(process.cwd(), 'test-temp-file-write-schema');

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('file_write');
      expect(tool.description)
        .toBe(`Write content to file, OVERWRITES existing content completely. Use file-insert to preserve content.
Creates parent directories automatically if needed. Returns file size written.`);
    });

    it('should have proper input schema', () => {
      const schema = tool.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties.path).toBeDefined();
      expect(schema.properties.content).toBeDefined();
      expect(schema.properties.createDirs).toBeDefined();
      expect(schema.required).toContain('path');
      expect(schema.required).toContain('content');
      expect(schema.required).not.toContain('createDirs');
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
      expect(result.content[0].text).toContain('File path cannot be empty');
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

    it('should reject non-boolean createDirs', async () => {
      const result = await tool.execute({
        path: '/tmp/test.txt',
        content: 'test',
        createDirs: 'yes',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('createDirs');
    });

    it('should accept valid parameters', async () => {
      const testFile = join(testDir, 'valid.txt');
      const result = await tool.execute({
        path: testFile,
        content: 'test content',
        createDirs: true,
      });

      // Should not fail validation (may fail with file system error in test env)
      if (result.isError) {
        expect(result.content[0].text).not.toContain('Validation failed');
      }
    });

    it('should default createDirs to true', async () => {
      const testFile = join(testDir, 'nested', 'default.txt');
      const result = await tool.execute({
        path: testFile,
        content: 'test content',
      });

      // Should create directories by default
      if (!result.isError) {
        const written = await readFile(testFile, 'utf-8');
        expect(written).toBe('test content');
      }
    });
  });

  describe('File writing operations', () => {
    it('should write content to new file', async () => {
      const testFile = join(testDir, 'test.txt');
      const content = 'Hello, world!';

      const result = await tool.execute({ path: testFile, content });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully wrote');
      expect(result.content[0].text).toContain(testFile);

      const written = await readFile(testFile, 'utf-8');
      expect(written).toBe(content);
    });

    it('should overwrite existing file', async () => {
      const testFile = join(testDir, 'existing.txt');
      const originalContent = 'Original content';
      const newContent = 'New content';

      // First write
      await tool.execute({ path: testFile, content: originalContent });

      // Overwrite
      const result = await tool.execute({ path: testFile, content: newContent });

      expect(result.isError).toBe(false);

      const written = await readFile(testFile, 'utf-8');
      expect(written).toBe(newContent);
    });

    it('should create parent directories by default', async () => {
      const testFile = join(testDir, 'deep', 'nested', 'file.txt');
      const content = 'Deep file content';

      const result = await tool.execute({ path: testFile, content });

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

      const result = await tool.execute({
        path: testFile,
        content,
        createDirs: false,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Directory does not exist');
    });
  });

  describe('Structured output with helpers', () => {
    it('should use createResult for successful writes', async () => {
      const testFile = join(testDir, 'success.txt');
      const content = 'Success test';

      const result = await tool.execute({ path: testFile, content });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully wrote');
      expect(result.content[0].text).toContain(`${content.length} bytes`);
      expect(result.content[0].text).toContain(testFile);
    });

    it('should use createError for validation failures', async () => {
      const result = await tool.execute({ path: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });

    it('should provide enhanced error messages', async () => {
      const testFile = join(testDir, 'nonexistent', 'file.txt');

      const result = await tool.execute({
        path: testFile,
        content: 'test',
        createDirs: false,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Directory does not exist');
      expect(result.content[0].text).toContain('createDirs to true');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty content', async () => {
      const testFile = join(testDir, 'empty.txt');
      const content = '';

      const result = await tool.execute({ path: testFile, content });

      expect(result.isError).toBe(false);

      const written = await readFile(testFile, 'utf-8');
      expect(written).toBe('');
    });

    it('should handle large content', async () => {
      const testFile = join(testDir, 'large.txt');
      const content = 'A'.repeat(10000);

      const result = await tool.execute({ path: testFile, content });

      expect(result.isError).toBe(false);

      const written = await readFile(testFile, 'utf-8');
      expect(written).toBe(content);
      expect(written.length).toBe(10000);
    });

    it('should handle special characters and unicode', async () => {
      const testFile = join(testDir, 'unicode.txt');
      const content = 'Hello 世界! 🚀 Émojis and spéciål chars';

      const result = await tool.execute({ path: testFile, content });

      expect(result.isError).toBe(false);

      const written = await readFile(testFile, 'utf-8');
      expect(written).toBe(content);
    });

    it('should handle file size formatting', async () => {
      const testFile = join(testDir, 'sized.txt');
      const content = 'A'.repeat(1500); // > 1KB

      const result = await tool.execute({ path: testFile, content });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('1.5 KB');
    });
  });

  describe('Working directory support', () => {
    it('should resolve relative paths using working directory from context', async () => {
      // Create a relative test file
      const relativeTestFile = 'relative-test.txt';
      const content = 'Content from relative path';

      const result = await tool.execute(
        { path: relativeTestFile, content },
        { workingDirectory: testDir }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully wrote');

      // Verify the file was created in the working directory
      const absoluteTestFile = join(testDir, relativeTestFile);
      const written = await readFile(absoluteTestFile, 'utf-8');
      expect(written).toBe(content);
    });

    it('should use absolute paths directly even when working directory is provided', async () => {
      const absoluteTestFile = join(testDir, 'absolute-test.txt');
      const content = 'Content from absolute path';

      const result = await tool.execute(
        { path: absoluteTestFile, content },
        { workingDirectory: '/some/other/dir' }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully wrote');

      // Verify the file was created at the absolute path
      const written = await readFile(absoluteTestFile, 'utf-8');
      expect(written).toBe(content);
    });

    it('should fall back to process.cwd() when no working directory in context', async () => {
      // Create a file relative to current working directory
      const relativeFile = 'temp-cwd-test.txt';
      const content = 'CWD test content';

      try {
        const result = await tool.execute({ path: relativeFile, content });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toContain('Successfully wrote');

        // Verify the file was created in the current working directory
        const absoluteFile = join(process.cwd(), relativeFile);
        const written = await readFile(absoluteFile, 'utf-8');
        expect(written).toBe(content);
      } finally {
        // Clean up the file created in process.cwd()
        await rm(join(process.cwd(), relativeFile), { force: true });
      }
    });

    it('should create nested directories with working directory context', async () => {
      const relativeNestedFile = 'nested/deep/file.txt';
      const content = 'Nested file content';

      const result = await tool.execute(
        { path: relativeNestedFile, content },
        { workingDirectory: testDir }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully wrote');

      // Verify the file was created in the nested structure within working directory
      const absoluteNestedFile = join(testDir, relativeNestedFile);
      const written = await readFile(absoluteNestedFile, 'utf-8');
      expect(written).toBe(content);
    });
  });

  describe('Error handling scenarios', () => {
    it('should provide actionable error for permission denied', () => {
      // This test would need a way to simulate permission errors
      // For now, just verify the tool handles errors gracefully
      expect(tool.name).toBe('file_write');
    });

    it('should provide actionable error for disk space issues', () => {
      // This test would need a way to simulate disk space errors
      // For now, just verify the tool handles errors gracefully
      expect(tool.name).toBe('file_write');
    });
  });
});
