// ABOUTME: Tests for directory listing tool with filtering
// ABOUTME: Validates directory listing, pattern matching, and recursion

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { FileListTool } from '../implementations/file-list.js';
import { createTestToolCall } from './test-utils.js';

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
      expect(tool.annotations?.readOnlyHint).toBe(true);
    });

    it('should have correct input schema', () => {
      expect(tool.inputSchema.properties).toHaveProperty('path');
      expect(tool.inputSchema.properties).toHaveProperty('pattern');
      expect(tool.inputSchema.properties).toHaveProperty('includeHidden');
      expect(tool.inputSchema.properties).toHaveProperty('recursive');
      expect(tool.inputSchema.required).toEqual([]);
    });
  });

  describe('basic listing', () => {
    it('should list files in specified directory', async () => {
      const result = await tool.executeTool(createTestToolCall('file_list', { path: testDir }));

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;

      expect(output).toContain('file1.txt');
      expect(output).toContain('file2.js');
      expect(output).toContain('subdir/');
      expect(output).not.toContain('.hidden'); // Hidden files excluded by default
    });

    it('should include hidden files when requested', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_list', {
          path: testDir,
          includeHidden: true,
        })
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;
      expect(output).toContain('.hidden');
    });

    it('should filter by pattern', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_list', {
          path: testDir,
          pattern: '*.txt',
        })
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;

      expect(output).toContain('file1.txt');
      expect(output).not.toContain('file2.js');
      expect(output).not.toContain('subdir/');
    });
  });

  describe('recursive listing', () => {
    it('should list recursively when enabled', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_list', {
          path: testDir,
          recursive: true,
        })
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;

      expect(output).toContain('file1.txt');
      expect(output).toContain('subdir/');
      expect(output).toContain('nested.txt');
      expect(output).toContain('deepdir/');
      expect(output).toContain('deep.txt');
    });

    it('should respect max depth', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_list', {
          path: testDir,
          recursive: true,
          maxDepth: 1,
        })
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;

      expect(output).toContain('subdir/');
      expect(output).toContain('nested.txt');
      expect(output).not.toContain('deep.txt'); // Should not go deeper than maxDepth
    });
  });

  describe('pattern matching', () => {
    it('should handle wildcard patterns', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_list', {
          path: testDir,
          pattern: 'file*',
        })
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;

      expect(output).toContain('file1.txt');
      expect(output).toContain('file2.js');
      expect(output).not.toContain('subdir/');
    });

    it('should handle question mark patterns', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_list', {
          path: testDir,
          pattern: 'file?.txt',
        })
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;

      expect(output).toContain('file1.txt');
      expect(output).not.toContain('file2.js');
    });

    it('should be case insensitive by default', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_list', {
          path: testDir,
          pattern: 'FILE*',
        })
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;
      expect(output).toContain('file1.txt');
    });
  });

  describe('error handling', () => {
    it('should handle non-existent directory', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_list', { path: '/non/existent/dir' })
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('ENOENT');
    });

    it('should return empty result for empty directory', async () => {
      const emptyDir = join(testDir, 'empty');
      await mkdir(emptyDir);

      const result = await tool.executeTool(createTestToolCall('file_list', { path: emptyDir }));

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('No files found');
    });
  });

  describe('output formatting', () => {
    it('should show file sizes', async () => {
      const result = await tool.executeTool(createTestToolCall('file_list', { path: testDir }));

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;
      expect(output).toMatch(/file1\.txt \(\d+ bytes\)/);
    });

    it('should distinguish directories with slash', async () => {
      const result = await tool.executeTool(createTestToolCall('file_list', { path: testDir }));

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;
      expect(output).toContain('subdir/');
    });

    it('should sort directories before files', async () => {
      const result = await tool.executeTool(createTestToolCall('file_list', { path: testDir }));

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;
      const lines = output.split('\n');

      const subdirIndex = lines.findIndex((line) => line.includes('subdir/'));
      const fileIndex = lines.findIndex((line) => line.includes('file1.txt'));

      expect(subdirIndex).toBeLessThan(fileIndex);
    });
  });

  describe('tree output format', () => {
    it('should output tree structure with proper characters', async () => {
      const result = await tool.executeTool(createTestToolCall('file_list', { path: testDir }));

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;

      // Should contain tree characters
      expect(output).toContain('├');
      expect(output).toContain('└');

      // Check basic structure
      expect(output).toMatch(/test-temp-file-list\/\n├ subdir\/\n├ file1\.txt/);
    });

    it('should use └ for last item at each level', async () => {
      const result = await tool.executeTool(createTestToolCall('file_list', { path: testDir }));

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;
      const lines = output.split('\n');

      // Find the last non-empty line that's not the root
      const lastItemLine = lines
        .filter((line) => line.trim() && !line.startsWith('test-temp-file-list'))
        .pop();
      expect(lastItemLine).toMatch(/^└/);
    });

    it('should show nested structure with proper indentation', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_list', { path: testDir, recursive: true })
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;

      // Check for nested indentation - we use spaces for indentation
      expect(output).toMatch(/├ subdir\/\n {2}├/);
    });
  });

  describe('summarization', () => {
    beforeEach(async () => {
      // Create node_modules structure for testing
      await mkdir(join(testDir, 'node_modules'));
      await mkdir(join(testDir, 'node_modules', 'package1'));
      await writeFile(join(testDir, 'node_modules', 'package1', 'index.js'), 'module1');
      await mkdir(join(testDir, 'node_modules', 'package2'));
      await writeFile(join(testDir, 'node_modules', 'package2', 'index.js'), 'module2');

      // Create .git directory
      await mkdir(join(testDir, '.git'));
      await writeFile(join(testDir, '.git', 'HEAD'), 'ref: refs/heads/main');

      // Create large directory for threshold testing
      await mkdir(join(testDir, 'large-dir'));
      for (let i = 0; i < 60; i++) {
        await writeFile(join(testDir, 'large-dir', `file${i}.txt`), `content${i}`);
      }
    });

    it('should always summarize node_modules', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_list', {
          path: testDir,
          recursive: true,
          includeHidden: true,
        })
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;

      // node_modules should be summarized, not expanded
      expect(output).toMatch(/├ node_modules\/ \(\d+ files; \d+ dirs\)/);
      expect(output).not.toContain('package1');
      expect(output).not.toContain('package2');
    });

    it('should always summarize .git directory', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_list', {
          path: testDir,
          recursive: true,
          includeHidden: true,
        })
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;

      // .git should be summarized even with few files
      expect(output).toMatch(/├ \.git\/ \(\d+ files; \d+ dirs\)/);
      expect(output).not.toContain('HEAD');
    });

    it('should summarize directories with more than threshold entries', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_list', {
          path: testDir,
          recursive: true,
          summaryThreshold: 50,
        })
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;

      // large-dir should be summarized
      expect(output).toMatch(/├ large-dir\/ \(60 files; 0 dirs\)/);
      expect(output).not.toContain('file50.txt');
    });

    it('should respect custom summaryThreshold', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_list', {
          path: testDir,
          recursive: true,
          summaryThreshold: 10,
        })
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;

      // With low threshold, large-dir should still be summarized
      expect(output).toMatch(/├ large-dir\/ \(60 files; 0 dirs\)/);
    });

    it('should not summarize top-level directories regardless of size', async () => {
      // Create many files in root
      for (let i = 0; i < 60; i++) {
        await writeFile(join(testDir, `root${i}.txt`), `content${i}`);
      }

      const result = await tool.executeTool(
        createTestToolCall('file_list', {
          path: testDir,
          summaryThreshold: 10,
        })
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;

      // Should still show all files at root level
      expect(output).toContain('root0.txt');
      expect(output).toContain('root59.txt');
    });

    it('should count files and directories correctly in summaries', async () => {
      // Create more complex structure
      await mkdir(join(testDir, 'node_modules', 'package1', 'lib'));
      await writeFile(join(testDir, 'node_modules', 'package1', 'lib', 'util.js'), 'util');
      await mkdir(join(testDir, 'node_modules', 'package3'));

      const result = await tool.executeTool(
        createTestToolCall('file_list', {
          path: testDir,
          recursive: true,
          includeHidden: true,
        })
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;

      // Should show correct counts
      expect(output).toMatch(/├ node_modules\/ \(3 files; 4 dirs\)/);
    });
  });

  describe('tree with patterns', () => {
    it('should apply pattern filtering in tree output', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_list', {
          path: testDir,
          pattern: '*.txt',
          recursive: true,
        })
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;

      // Should show .txt files but not .js files
      expect(output).toContain('file1.txt');
      expect(output).toContain('nested.txt');
      expect(output).not.toContain('file2.js');

      // Should still show directory structure
      expect(output).toContain('subdir/');
    });
  });

  describe('tree with hidden files', () => {
    it('should show hidden files in tree when requested', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_list', {
          path: testDir,
          includeHidden: true,
        })
      );

      expect(result.isError).toBe(false);
      const output = result.content[0].text!;

      expect(output).toContain('.hidden');
      // Hidden files should be sorted with other files
      expect(output).toMatch(/├ \.hidden/);
    });
  });

  describe('input schema', () => {
    it('should include summaryThreshold parameter', () => {
      expect(tool.inputSchema.properties).toHaveProperty('summaryThreshold');
      expect(tool.inputSchema.properties.summaryThreshold).toEqual({
        type: 'number',
        description: 'Number of entries before summarizing (default: 50)',
      });
    });
  });
});
