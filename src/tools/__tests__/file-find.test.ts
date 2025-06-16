// ABOUTME: Tests for file finding tool with glob pattern matching
// ABOUTME: Validates file discovery, pattern matching, and filtering options

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { FileFindTool } from '../implementations/file-find.js';

describe('FileFindTool', () => {
  const tool = new FileFindTool();
  const testDir = join(process.cwd(), 'test-temp-file-find');

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await mkdir(testDir, { recursive: true });

    // Create test structure
    await writeFile(join(testDir, 'test.ts'), 'content');
    await writeFile(join(testDir, 'test.js'), 'content');
    await writeFile(join(testDir, 'index.html'), 'content');
    await writeFile(join(testDir, 'README.md'), 'content');
    await writeFile(join(testDir, '.gitignore'), 'content');

    await mkdir(join(testDir, 'src'));
    await writeFile(join(testDir, 'src', 'app.ts'), 'content');
    await writeFile(join(testDir, 'src', 'utils.ts'), 'content');
    await mkdir(join(testDir, 'src', 'components'));
    await writeFile(join(testDir, 'src', 'components', 'Button.tsx'), 'content');

    await mkdir(join(testDir, 'test'));
    await writeFile(join(testDir, 'test', 'app.test.ts'), 'content');

    await mkdir(join(testDir, 'node_modules'));
    await writeFile(join(testDir, 'node_modules', 'package.js'), 'content');

    await mkdir(join(testDir, '.hidden'));
    await writeFile(join(testDir, '.hidden', 'secret.txt'), 'content');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('file_find');
      expect(tool.description).toBe('Find files by name pattern or glob');
      expect(tool.destructive).toBe(false);
    });

    it('should have correct input schema', () => {
      expect(tool.input_schema).toEqual({
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'File name pattern or glob (e.g., "*.ts", "test*")',
          },
          path: {
            type: 'string',
            description: 'Directory to search in (default: current directory)',
          },
          type: {
            type: 'string',
            description: 'Type of entries to find',
            enum: ['file', 'directory', 'both'],
          },
          caseSensitive: { type: 'boolean', description: 'Case sensitive search (default: false)' },
          maxDepth: { type: 'number', description: 'Maximum search depth (default: 10)' },
          includeHidden: {
            type: 'boolean',
            description: 'Include hidden files/directories (default: false)',
          },
        },
        required: ['pattern'],
      });
    });
  });

  describe('basic file finding', () => {
    it('should find files by extension', async () => {
      const result = await tool.executeTool({
        pattern: '*.ts',
        path: testDir,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('test.ts');
      expect(output).toContain('app.ts');
      expect(output).toContain('utils.ts');
      expect(output).toContain('app.test.ts');
      expect(output).not.toContain('test.js');
      expect(output).not.toContain('Button.tsx');
    });

    it('should find files by name prefix', async () => {
      const result = await tool.executeTool({
        pattern: 'test*',
        path: testDir,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('test.ts');
      expect(output).toContain('test.js');
      expect(output).toContain(join(testDir, 'test')); // directory
      expect(output).not.toContain('app.ts');
    });

    it('should handle wildcard patterns', async () => {
      const result = await tool.executeTool({
        pattern: '*app*',
        path: testDir,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('app.ts');
      expect(output).toContain('app.test.ts');
      expect(output).not.toContain(join(testDir, 'test.ts'));
    });

    it('should handle question mark patterns', async () => {
      const result = await tool.executeTool({
        pattern: 'test.?s',
        path: testDir,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('test.ts');
      expect(output).toContain('test.js');
      expect(output).not.toContain('README.md');
    });
  });

  describe('type filtering', () => {
    it('should find only files when type=file', async () => {
      const result = await tool.executeTool({
        pattern: '*',
        path: testDir,
        type: 'file',
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('test.ts');
      expect(output).toContain('test.js');
      // Should contain files from src directory but not the directory itself
      expect(output).toContain('app.ts');
      expect(output).not.toContain(join(testDir, 'src') + '\n'); // Directory should not appear as a line
      expect(output).not.toContain(join(testDir, 'test') + '\n'); // Directory should not appear as a line
    });

    it('should find only directories when type=directory', async () => {
      const result = await tool.executeTool({
        pattern: '*',
        path: testDir,
        type: 'directory',
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('src');
      expect(output).toContain('test');
      expect(output).toContain('node_modules');
      expect(output).not.toContain('test.ts');
      expect(output).not.toContain('test.js');
    });

    it('should find both files and directories by default', async () => {
      const result = await tool.executeTool({
        pattern: 'test*',
        path: testDir,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('test.ts');
      expect(output).toContain('test.js');
      expect(output).toContain(join(testDir, 'test'));
    });
  });

  describe('case sensitivity', () => {
    it('should be case insensitive by default', async () => {
      const result = await tool.executeTool({
        pattern: 'README*',
        path: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.content[0].text).toContain('README.md');
    });

    it('should respect case sensitivity when enabled', async () => {
      const caseSensitive = await tool.executeTool({
        pattern: 'readme*',
        path: testDir,
        caseSensitive: true,
      });

      const caseInsensitive = await tool.executeTool({
        pattern: 'readme*',
        path: testDir,
        caseSensitive: false,
      });

      expect(caseSensitive.success).toBe(true);
      expect(caseSensitive.content[0].text).toContain('No files found');

      expect(caseInsensitive.success).toBe(true);
      expect(caseInsensitive.content[0].text).toContain('README.md');
    });
  });

  describe('hidden files and directories', () => {
    it('should exclude hidden files by default', async () => {
      const result = await tool.executeTool({
        pattern: '.*',
        path: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.content[0].text).toContain('No files found');
    });

    it('should include hidden files when requested', async () => {
      const result = await tool.executeTool({
        pattern: '.*',
        path: testDir,
        includeHidden: true,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('.gitignore');
      expect(output).toContain('.hidden');
    });

    it('should find files in hidden directories when enabled', async () => {
      const result = await tool.executeTool({
        pattern: 'secret.txt',
        path: testDir,
        includeHidden: true,
      });

      expect(result.success).toBe(true);
      expect(result.content[0].text).toContain('secret.txt');
    });
  });

  describe('depth control', () => {
    it('should respect max depth limitation', async () => {
      const result = await tool.executeTool({
        pattern: '*.tsx',
        path: testDir,
        maxDepth: 1,
      });

      expect(result.success).toBe(true);
      expect(result.content[0].text).toContain('No files found');
    });

    it('should find files at allowed depth', async () => {
      const result = await tool.executeTool({
        pattern: '*.tsx',
        path: testDir,
        maxDepth: 2,
      });

      expect(result.success).toBe(true);
      expect(result.content[0].text).toContain('Button.tsx');
    });

    it('should use reasonable default max depth', async () => {
      const result = await tool.executeTool({
        pattern: '*.tsx',
        path: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.content[0].text).toContain('Button.tsx');
    });
  });

  describe('error handling', () => {
    it('should handle missing pattern parameter', async () => {
      const result = await tool.executeTool({ path: testDir });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Pattern must be a non-empty string');
    });

    it('should handle empty pattern parameter', async () => {
      const result = await tool.executeTool({ pattern: '', path: testDir });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Pattern must be a non-empty string');
    });

    it('should handle non-string pattern parameter', async () => {
      const result = await tool.executeTool({ pattern: 123, path: testDir });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Pattern must be a non-empty string');
    });

    it('should handle non-existent directory', async () => {
      const result = await tool.executeTool({
        pattern: '*.ts',
        path: '/non/existent/directory',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });
  });

  describe('output format', () => {
    it('should return sorted results', async () => {
      const result = await tool.executeTool({
        pattern: '*.ts',
        path: testDir,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;
      const files = output.split('\n').filter((line) => line.trim());

      // Files should be sorted
      const sortedFiles = [...files].sort();
      expect(files).toEqual(sortedFiles);
    });

    it('should return no matches message when nothing found', async () => {
      const result = await tool.executeTool({
        pattern: '*.nonexistent',
        path: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.content[0].text).toBe('No files found matching pattern: *.nonexistent');
    });

    it('should return full paths', async () => {
      const result = await tool.executeTool({
        pattern: 'app.ts',
        path: testDir,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;
      expect(output).toContain(join(testDir, 'src', 'app.ts'));
    });
  });

  describe('complex patterns', () => {
    it('should handle multiple character wildcards', async () => {
      const result = await tool.executeTool({
        pattern: '*.t*',
        path: testDir,
        includeHidden: true,
      });

      expect(result.success).toBe(true);
      const output = result.content[0].text!;

      expect(output).toContain('test.ts');
      expect(output).toContain('app.ts');
      expect(output).toContain('app.test.ts');
      expect(output).toContain('secret.txt');
      expect(output).not.toContain('test.js');
    });

    it('should handle patterns with special characters', async () => {
      // Create files with special characters
      await writeFile(join(testDir, 'file-with-dash.ts'), 'content');
      await writeFile(join(testDir, 'file_with_underscore.js'), 'content');

      const result = await tool.executeTool({
        pattern: '*-*',
        path: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.content[0].text).toContain('file-with-dash.ts');
      expect(result.content[0].text).not.toContain('file_with_underscore.js');
    });
  });
});
