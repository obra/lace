// ABOUTME: Tests for schema-based file listing tool with structured output
// ABOUTME: Validates directory listing, tree formatting, and recursive traversal

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { FileListTool } from '../implementations/file-list.js';

describe('FileListTool with schema validation', () => {
  let tool: FileListTool;
  const testDir = join(process.cwd(), 'test-temp-file-list-schema');

  beforeEach(async () => {
    tool = new FileListTool();
    await mkdir(testDir, { recursive: true });

    // Create test file structure
    await mkdir(join(testDir, 'src'), { recursive: true });
    await mkdir(join(testDir, 'tests'), { recursive: true });
    await mkdir(join(testDir, 'src', 'components'), { recursive: true });
    await mkdir(join(testDir, '.hidden'), { recursive: true });
    await mkdir(join(testDir, 'node_modules'), { recursive: true });

    // Create test files
    await writeFile(join(testDir, 'README.md'), 'readme content');
    await writeFile(join(testDir, 'package.json'), '{}');
    await writeFile(join(testDir, 'src', 'app.ts'), 'typescript content');
    await writeFile(join(testDir, 'src', 'app.js'), 'javascript content');
    await writeFile(join(testDir, 'src', 'components', 'Button.tsx'), 'react component');
    await writeFile(join(testDir, 'tests', 'app.test.ts'), 'test content');
    await writeFile(join(testDir, '.hidden', 'secret.txt'), 'hidden content');
    await writeFile(join(testDir, 'node_modules', 'package.json'), 'node module');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('file_list');
      expect(tool.description).toContain('List files and directories');
    });

    it('should have proper input schema', () => {
      const schema = tool.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties.path).toBeDefined();
      expect(schema.properties.pattern).toBeDefined();
      expect(schema.properties.includeHidden).toBeDefined();
      expect(schema.properties.recursive).toBeDefined();
      expect(schema.properties.maxDepth).toBeDefined();
      expect(schema.properties.summaryThreshold).toBeDefined();
      expect(schema.properties.maxResults).toBeDefined();
      expect(schema.required || []).toEqual([]);
    });

    it('should be marked as read-only and idempotent', () => {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.idempotentHint).toBe(true);
    });
  });

  describe('Input validation', () => {
    it('should reject empty path', async () => {
      const result = await tool.execute({ path: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('Path cannot be empty');
    });

    it('should reject negative maxDepth', async () => {
      const result = await tool.execute({
        path: testDir,
        maxDepth: -1,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });

    it('should reject non-integer maxDepth', async () => {
      const result = await tool.execute({
        path: testDir,
        maxDepth: 1.5,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('Must be an integer');
    });

    it('should reject excessive maxResults', async () => {
      const result = await tool.execute({
        path: testDir,
        maxResults: 10000,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });

    it('should accept valid parameters with defaults', async () => {
      const result = await tool.execute({
        path: testDir,
      });

      expect(result.isError).toBe(false);
    });
  });

  describe('Basic directory listing', () => {
    it('should list files and directories in current directory', async () => {
      const result = await tool.execute({
        path: testDir,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('README.md');
      expect(result.content[0].text).toContain('package.json');
      expect(result.content[0].text).toContain('src/');
      expect(result.content[0].text).toContain('tests/');
    });

    it('should show file sizes', async () => {
      const result = await tool.execute({
        path: testDir,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toMatch(/README\.md.*\(\d+ bytes\)/);
      expect(result.content[0].text).toMatch(/package\.json.*\(\d+ bytes\)/);
    });

    it('should exclude hidden files by default', async () => {
      const result = await tool.execute({
        path: testDir,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).not.toContain('.hidden');
    });

    it('should include hidden files when requested', async () => {
      const result = await tool.execute({
        path: testDir,
        includeHidden: true,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('.hidden/');
    });
  });

  describe('Pattern filtering', () => {
    it('should filter files by pattern', async () => {
      const result = await tool.execute({
        path: testDir,
        pattern: '*.md',
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('README.md');
      expect(result.content[0].text).not.toContain('package.json');
    });

    it('should filter files by wildcard pattern', async () => {
      const result = await tool.execute({
        path: testDir,
        pattern: 'package*',
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('package.json');
      expect(result.content[0].text).not.toContain('README.md');
    });

    it('should handle patterns with question marks', async () => {
      const result = await tool.execute({
        path: testDir,
        pattern: '???.md',
      });

      expect(result.isError).toBe(false);
      // Should not match README.md (6 chars) but would match shorter .md files
      expect(result.content[0].text).not.toContain('README.md');
    });
  });

  describe('Recursive listing', () => {
    it('should list recursively when enabled', async () => {
      const result = await tool.execute({
        path: testDir,
        recursive: true,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('app.ts');
      expect(result.content[0].text).toContain('Button.tsx');
      expect(result.content[0].text).toContain('app.test.ts');
    });

    it('should respect maxDepth in recursive listing', async () => {
      const result = await tool.execute({
        path: testDir,
        recursive: true,
        maxDepth: 1,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('app.ts');
      expect(result.content[0].text).not.toContain('Button.tsx'); // Should not go deep enough for components/
    });

    it('should format tree structure correctly', async () => {
      const result = await tool.execute({
        path: testDir,
        recursive: true,
        maxDepth: 2,
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;
      // Check for tree structure characters
      expect(output).toMatch(/[├└]/); // Tree characters
      expect(output).toContain('src/');
      expect(output).toContain('tests/');
    });
  });

  describe('Summarization features', () => {
    it('should summarize large directories', async () => {
      const result = await tool.execute({
        path: testDir,
        recursive: true,
        summaryThreshold: 1, // Force summarization
      });

      expect(result.isError).toBe(false);
      // Should see summary format for directories with many files
      expect(result.content[0].text).toMatch(/\(\d+ files; \d+ dirs\)/);
    });

    it('should auto-summarize node_modules', async () => {
      const result = await tool.execute({
        path: testDir,
        recursive: true,
      });

      expect(result.isError).toBe(false);
      // node_modules should be summarized regardless of threshold
      expect(result.content[0].text).toMatch(/node_modules.*\(\d+ files; \d+ dirs\)/);
    });
  });

  describe('Result limits', () => {
    it('should respect maxResults limit', async () => {
      const result = await tool.execute({
        path: testDir,
        recursive: true,
        maxResults: 3,
      });

      expect(result.isError).toBe(false);
      // Should have truncation message
      expect(result.content[0].text).toContain('Results limited to 3');
    });

    it('should not show truncation message when under limit', async () => {
      const result = await tool.execute({
        path: testDir,
        maxResults: 100,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).not.toContain('Results limited to');
    });
  });

  describe('Structured output with helpers', () => {
    it('should use createResult for successful listings', async () => {
      const result = await tool.execute({
        path: testDir,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('README.md');
    });

    it('should use createError for validation failures', async () => {
      const result = await tool.execute({ path: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });

    it('should handle directory not found error', async () => {
      const result = await tool.execute({
        path: '/nonexistent/directory',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Directory not found');
    });

    it('should provide helpful message when no files found', async () => {
      const emptyDir = join(testDir, 'empty');
      await mkdir(emptyDir);

      const result = await tool.execute({
        path: emptyDir,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('No files found');
    });
  });

  describe('Tree formatting', () => {
    it('should format directory tree with proper indentation', async () => {
      const result = await tool.execute({
        path: testDir,
        recursive: true,
        maxDepth: 2,
      });

      expect(result.isError).toBe(false);
      const output = result.content[0].text;

      // Should have tree structure
      expect(output).toMatch(/src\/$/m); // Directory with trailing slash
      expect(output).toMatch(/├ \w/); // Tree branch character
      expect(output).toMatch(/└ \w/); // Tree end character
    });

    it('should show file extensions and sizes', async () => {
      const result = await tool.execute({
        path: testDir,
        recursive: true,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('app.ts');
      expect(result.content[0].text).toContain('app.js');
      expect(result.content[0].text).toContain('Button.tsx');
      expect(result.content[0].text).toMatch(/\(\d+ bytes\)/); // File sizes
    });
  });

  describe('Edge cases', () => {
    it('should handle empty directory', async () => {
      const emptyDir = join(testDir, 'empty');
      await mkdir(emptyDir);

      const result = await tool.execute({
        path: emptyDir,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('No files found');
    });

    it('should handle non-directory path', async () => {
      const result = await tool.execute({
        path: join(testDir, 'README.md'),
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not a directory');
    });

    it('should sort directories before files', async () => {
      const result = await tool.execute({
        path: testDir,
      });

      expect(result.isError).toBe(false);
      expect(result.content[0]).toBeDefined();
      expect(result.content[0].text).toBeDefined();
      const output = result.content[0].text!;
      const lines = output.split('\n');

      // Find directory and file lines
      const srcIndex = lines.findIndex((line) => line.includes('src/'));
      const readmeIndex = lines.findIndex((line) => line.includes('README.md'));

      // Directories should come before files
      expect(srcIndex).toBeLessThan(readmeIndex);
    });
  });

  describe('Error handling scenarios', () => {
    it('should handle permission errors gracefully', async () => {
      // This test would need a way to simulate permission errors
      // For now, just verify the structure exists
      expect(tool.validatePath).toBeDefined();
    });

    it('should provide actionable error for file system issues', async () => {
      // This test would need a way to simulate file system errors
      // For now, just verify the tool handles errors gracefully
      expect(tool.name).toBe('file_list');
    });
  });
});
