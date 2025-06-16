// ABOUTME: Tests for directory listing tool with filtering
// ABOUTME: Validates directory listing, pattern matching, and recursion

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { FileListTool } from '../implementations/file-list.js';

describe('FileListTool', () => {
  const tool = new FileListTool();
  const testDir = join(process.cwd(), 'test-temp-file-list');

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await mkdir(testDir, { recursive: true });

    // Create test structure
    await writeFile(join(testDir, 'file1.txt'), 'content1');
    await writeFile(join(testDir, 'file2.js'), 'content2');
    await writeFile(join(testDir, '.hidden'), 'hidden content');

    await mkdir(join(testDir, 'subdir'));
    await writeFile(join(testDir, 'subdir', 'nested.txt'), 'nested content');
    await mkdir(join(testDir, 'subdir', 'deepdir'));
    await writeFile(join(testDir, 'subdir', 'deepdir', 'deep.txt'), 'deep content');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('file_list');
      expect(tool.description).toBe('List files and directories with optional filtering');
      expect(tool.destructive).toBe(false);
    });

    it('should have correct input schema', () => {
      expect(tool.input_schema.properties).toHaveProperty('path');
      expect(tool.input_schema.properties).toHaveProperty('pattern');
      expect(tool.input_schema.properties).toHaveProperty('includeHidden');
      expect(tool.input_schema.properties).toHaveProperty('recursive');
      expect(tool.input_schema.required).toEqual([]);
    });
  });

  describe('basic listing', () => {
    it('should list files in specified directory', async () => {
      const result = await tool.executeTool({ path: testDir });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('file1.txt');
      expect(output).toContain('file2.js');
      expect(output).toContain('subdir/');
      expect(output).not.toContain('.hidden'); // Hidden files excluded by default
    });

    it('should include hidden files when requested', async () => {
      const result = await tool.executeTool({
        path: testDir,
        includeHidden: true,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;
      expect(output).toContain('.hidden');
    });

    it('should filter by pattern', async () => {
      const result = await tool.executeTool({
        path: testDir,
        pattern: '*.txt',
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('file1.txt');
      expect(output).not.toContain('file2.js');
      expect(output).not.toContain('subdir/');
    });
  });

  describe('recursive listing', () => {
    it('should list recursively when enabled', async () => {
      const result = await tool.executeTool({
        path: testDir,
        recursive: true,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('file1.txt');
      expect(output).toContain('subdir/');
      expect(output).toContain(join(testDir, 'subdir', 'nested.txt'));
      expect(output).toContain(join(testDir, 'subdir', 'deepdir/'));
      expect(output).toContain(join(testDir, 'subdir', 'deepdir', 'deep.txt'));
    });

    it('should respect max depth', async () => {
      const result = await tool.executeTool({
        path: testDir,
        recursive: true,
        maxDepth: 1,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('subdir/');
      expect(output).toContain(join(testDir, 'subdir', 'nested.txt'));
      expect(output).not.toContain('deep.txt'); // Should not go deeper than maxDepth
    });
  });

  describe('pattern matching', () => {
    it('should handle wildcard patterns', async () => {
      const result = await tool.executeTool({
        path: testDir,
        pattern: 'file*',
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('file1.txt');
      expect(output).toContain('file2.js');
      expect(output).not.toContain('subdir/');
    });

    it('should handle question mark patterns', async () => {
      const result = await tool.executeTool({
        path: testDir,
        pattern: 'file?.txt',
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('file1.txt');
      expect(output).not.toContain('file2.js');
    });

    it('should be case insensitive by default', async () => {
      const result = await tool.executeTool({
        path: testDir,
        pattern: 'FILE*',
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;
      expect(output).toContain('file1.txt');
    });
  });

  describe('error handling', () => {
    it('should handle non-existent directory', async () => {
      const result = await tool.executeTool({ path: '/non/existent/dir' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });

    it('should return empty result for empty directory', async () => {
      const emptyDir = join(testDir, 'empty');
      await mkdir(emptyDir);

      const result = await tool.executeTool({ path: emptyDir });

      expect(result.success).toBe(true);
      expect(result.content[0].text).toBe('No files found');
    });
  });

  describe('output formatting', () => {
    it('should show file sizes', async () => {
      const result = await tool.executeTool({ path: testDir });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;
      expect(output).toMatch(/file1\.txt \(\d+ bytes\)/);
    });

    it('should distinguish directories with slash', async () => {
      const result = await tool.executeTool({ path: testDir });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;
      expect(output).toContain('subdir/');
    });

    it('should sort directories before files', async () => {
      const result = await tool.executeTool({ path: testDir });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;
      const lines = output.split('\n');

      const subdirIndex = lines.findIndex((line) => line.includes('subdir/'));
      const fileIndex = lines.findIndex((line) => line.includes('file1.txt'));

      expect(subdirIndex).toBeLessThan(fileIndex);
    });
  });
});
