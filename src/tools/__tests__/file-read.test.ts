// ABOUTME: Tests for file reading tool with range support
// ABOUTME: Validates file reading, line ranges, and error handling

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { FileReadTool } from '../implementations/file-read.js';
import { createTestToolCall } from './test-utils.js';

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
      expect(tool.description).toBe('Read file contents with optional line range');
      expect(tool.annotations?.readOnlyHint).toBe(true);
    });

    it('should have correct input schema', () => {
      expect(tool.inputSchema).toEqual({
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
          startLine: { type: 'number', description: 'Starting line number (1-based, optional)' },
          endLine: { type: 'number', description: 'Ending line number (1-based, optional)' },
        },
        required: ['path'],
      });
    });
  });

  describe('file reading', () => {
    it('should read entire file when no range specified', async () => {
      const result = await tool.executeTool(createTestToolCall('file_read', { path: testFile }));

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe(testContent);
    });

    it('should read specific line range', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_read', {
          path: testFile,
          startLine: 2,
          endLine: 4,
        })
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('Line 2\nLine 3\nLine 4');
    });

    it('should read from start line to end of file', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_read', {
          path: testFile,
          startLine: 3,
        })
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('Line 3\nLine 4\nLine 5');
    });

    it('should read from beginning to end line', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_read', {
          path: testFile,
          endLine: 2,
        })
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('Line 1\nLine 2');
    });
  });

  describe('error handling', () => {
    it('should handle missing path parameter', async () => {
      const result = await tool.executeTool(createTestToolCall('file_read', {}));

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Path must be a non-empty string');
    });

    it('should handle empty path parameter', async () => {
      const result = await tool.executeTool(createTestToolCall('file_read', { path: '' }));

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Path must be a non-empty string');
    });

    it('should handle non-existent file', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_read', { path: '/non/existent/file.txt' })
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('ENOENT');
    });

    it('should handle start line beyond file length', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_read', {
          path: testFile,
          startLine: 10,
        })
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Start line 10 exceeds file length (5 lines)');
    });

    it('should handle end line beyond file length gracefully', async () => {
      const result = await tool.executeTool(
        createTestToolCall('file_read', {
          path: testFile,
          startLine: 3,
          endLine: 10,
        })
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('Line 3\nLine 4\nLine 5');
    });
  });

  describe('edge cases', () => {
    it('should handle empty file', async () => {
      const emptyFile = join(testDir, 'empty.txt');
      await writeFile(emptyFile, '');

      const result = await tool.executeTool(createTestToolCall('file_read', { path: emptyFile }));

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('');
    });

    it('should handle single line file', async () => {
      const singleLineFile = join(testDir, 'single.txt');
      await writeFile(singleLineFile, 'Only line');

      const result = await tool.executeTool(
        createTestToolCall('file_read', { path: singleLineFile })
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('Only line');
    });
  });
});
