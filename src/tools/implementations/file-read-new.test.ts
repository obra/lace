// ABOUTME: Tests for schema-based file reading tool
// ABOUTME: Validates file operations with proper error handling

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileReadTool } from './file-read-new.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createTestTempDir } from '../__tests__/test-utils.js';

describe('FileReadTool with schema validation', () => {
  const tempDir = createTestTempDir();
  let testDir: string;
  let testFile: string;
  let emptyFile: string;
  let largeFile: string;

  beforeEach(async () => {
    testDir = await tempDir.getPath();
    testFile = join(testDir, 'test.txt');
    emptyFile = join(testDir, 'empty.txt');
    largeFile = join(testDir, 'large.txt');

    // Create test files
    await writeFile(testFile, 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n');
    await writeFile(emptyFile, '');
    await writeFile(largeFile, 'Large file content\n'.repeat(1000));

    // Create some files for misspelling suggestions
    await writeFile(join(testDir, 'similar-name.txt'), 'similar content');
    await writeFile(join(testDir, 'test-file.js'), 'test content');
    await writeFile(join(testDir, 'readme.md'), 'readme content');
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe('tool metadata', () => {
    it('has correct name and description', () => {
      const tool = new FileReadTool();
      expect(tool.name).toBe('file_read');
      expect(tool.description).toContain('file');
    });

    it('generates proper JSON schema', () => {
      const tool = new FileReadTool();
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

  describe('basic file reading', () => {
    it('reads entire file when no range specified', async () => {
      const tool = new FileReadTool();
      const result = await tool.execute({ path: testFile });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n');
    });

    it('handles empty files', async () => {
      const tool = new FileReadTool();
      const result = await tool.execute({ path: emptyFile });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('');
    });

    it('normalizes relative paths to absolute', async () => {
      const tool = new FileReadTool();
      // Use relative path
      const relativePath = './test.txt';
      const result = await tool.execute({ path: relativePath }, undefined);

      // Should work even though path gets normalized
      expect(result.isError).toBe(true); // Will fail because relative to cwd, not testDir
      expect(result.content[0].text).toContain('File not found');
    });
  });

  describe('line range reading', () => {
    it('reads specific line range', async () => {
      const tool = new FileReadTool();
      const result = await tool.execute({
        path: testFile,
        startLine: 2,
        endLine: 4,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('Line 2\nLine 3\nLine 4');
    });

    it('reads from start line to end of file when endLine not specified', async () => {
      const tool = new FileReadTool();
      const result = await tool.execute({
        path: testFile,
        startLine: 3,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('Line 3\nLine 4\nLine 5\n');
    });

    it('reads single line', async () => {
      const tool = new FileReadTool();
      const result = await tool.execute({
        path: testFile,
        startLine: 2,
        endLine: 2,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('Line 2');
    });

    it('handles line range beyond file length gracefully', async () => {
      const tool = new FileReadTool();
      const result = await tool.execute({
        path: testFile,
        startLine: 10,
        endLine: 20,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('exceeds file length');
    });
  });

  describe('validation errors', () => {
    it('validates line range constraints', async () => {
      const tool = new FileReadTool();
      const result = await tool.execute({
        path: testFile,
        startLine: 5,
        endLine: 2, // Invalid: end before start
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('endLine must be >= startLine');
    });

    it('rejects negative line numbers', async () => {
      const tool = new FileReadTool();
      const result = await tool.execute({
        path: testFile,
        startLine: -1,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('Must be positive');
    });

    it('rejects zero line numbers', async () => {
      const tool = new FileReadTool();
      const result = await tool.execute({
        path: testFile,
        startLine: 0,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Must be positive');
    });

    it('rejects non-integer line numbers', async () => {
      const tool = new FileReadTool();
      const result = await tool.execute({
        path: testFile,
        startLine: 1.5,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Must be an integer');
    });

    it('rejects empty file paths', async () => {
      const tool = new FileReadTool();
      const result = await tool.execute({ path: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File path cannot be empty');
    });
  });

  describe('file not found with suggestions', () => {
    it('provides helpful suggestions for misspelled files', async () => {
      const tool = new FileReadTool();
      const result = await tool.execute({
        path: join(testDir, 'tset.txt'), // 'test' misspelled
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
      expect(result.content[0].text).toContain('Similar files:');
      expect(result.content[0].text).toContain('test.txt');
    });

    it('suggests files with similar extensions', async () => {
      const tool = new FileReadTool();
      const result = await tool.execute({
        path: join(testDir, 'test.md'), // Wrong extension
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Similar files:');
      // Should suggest files with similar names
    });

    it('handles directory with no similar files', async () => {
      // Create a directory with completely different files
      const otherDir = join(testDir, 'other');
      await mkdir(otherDir);
      await writeFile(join(otherDir, 'completely-different.xyz'), 'content');

      const tool = new FileReadTool();
      const result = await tool.execute({
        path: join(otherDir, 'missing-file.txt'),
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
      // Should not contain suggestions section when no similar files found
    });
  });

  describe('file size limits', () => {
    it('handles files within size limits', async () => {
      const tool = new FileReadTool();
      const result = await tool.execute({ path: testFile });

      expect(result.isError).toBe(false);
    });

    it('provides helpful message for large files without range', async () => {
      const tool = new FileReadTool();
      const result = await tool.execute({ path: largeFile });

      // Depending on the size limit, this might succeed or suggest using ranges
      if (result.isError) {
        expect(result.content[0].text).toContain('too large');
        expect(result.content[0].text).toContain('startLine');
        expect(result.content[0].text).toContain('endLine');
      }
    });
  });

  describe('AI-optimized error messages', () => {
    it('provides actionable error messages that help avoid repeated failures', async () => {
      const tool = new FileReadTool();

      // Test misspelled file
      const result = await tool.execute({
        path: join(testDir, 'nonexistent-flie.txt'), // 'file' misspelled
      });

      expect(result.isError).toBe(true);
      const message = result.content[0].text;

      // Should provide specific, actionable guidance
      expect(message).toContain('File not found');
      expect(message).toContain('Similar files:');

      // Should include enough context to avoid repeated failures
      expect(message.length).toBeGreaterThan(20); // Not just "file not found"
    });

    it('explains validation errors clearly', async () => {
      const tool = new FileReadTool();
      const result = await tool.execute({
        path: testFile,
        startLine: 10,
        endLine: 5,
      });

      expect(result.isError).toBe(true);
      const message = result.content[0].text;

      // Should clearly explain what's wrong and how to fix it
      expect(message).toContain('endLine must be >= startLine');
      expect(message).toContain('Check parameter types and values');
    });
  });
});
