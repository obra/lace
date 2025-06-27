// ABOUTME: Tests for the file insert tool
// ABOUTME: Validates line-based insertion and end-of-file appending

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileInsertTool } from '../implementations/file-insert.js';
import { createTestToolCall } from './test-utils.js';
import { writeFile, unlink, mkdir, rmdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('FileInsertTool', () => {
  const tool = new FileInsertTool();
  const testDir = join(tmpdir(), 'file-insert-test');
  const testFile = join(testDir, 'test.txt');

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await unlink(testFile);
    } catch {
      // Ignore if file doesn't exist
    }
    await rmdir(testDir);
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('file_insert');
    expect(tool.annotations?.destructiveHint).toBe(true);
    expect(tool.inputSchema.required).toEqual(['path', 'content']);
  });

  it('should append to end of file by default', async () => {
    await writeFile(testFile, 'Line 1\nLine 2');

    const result = await tool.executeTool(createTestToolCall('file_insert', {
      path: testFile,
      content: 'Line 3\nLine 4',
    }));

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Appended to end of file');
    expect(result.content[0]?.text).toContain('+2 lines');
  });

  it('should insert at specific line', async () => {
    await writeFile(testFile, 'Line 1\nLine 2\nLine 3');

    const result = await tool.executeTool(createTestToolCall('file_insert', {
      path: testFile,
      content: 'Inserted Line',
      line: 2,
    }));

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Inserted after line 2');
  });

  it('should handle empty files', async () => {
    await writeFile(testFile, '');

    const result = await tool.executeTool(createTestToolCall('file_insert', {
      path: testFile,
      content: 'First Line',
    }));

    expect(result.isError).toBe(false);
  });

  it('should fail when line exceeds file length', async () => {
    await writeFile(testFile, 'Line 1\nLine 2');

    const result = await tool.executeTool(createTestToolCall('file_insert', {
      path: testFile,
      content: 'New Line',
      line: 5,
    }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Line 5 exceeds file length');
  });

  it('should validate input parameters', async () => {
    const result = await tool.executeTool(createTestToolCall('file_insert', {
      path: '',
      content: 'test',
    }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Path must be a non-empty string');
  });

  it('should validate line number', async () => {
    await writeFile(testFile, 'test');

    const result = await tool.executeTool(createTestToolCall('file_insert', {
      path: testFile,
      content: 'test',
      line: 0,
    }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Line must be a positive number');
  });
});
