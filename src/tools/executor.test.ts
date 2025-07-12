// ABOUTME: Tests for ToolExecutor with new schema-based tools
// ABOUTME: Validates that new Tool classes work with existing executor infrastructure

import { describe, it, expect } from 'vitest';
import { ToolExecutor } from '~/tools/executor';
import { FileReadTool } from '~/tools/implementations/file-read';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { createTestTempDir } from '~/tools/__tests__/test-utils';

describe('ToolExecutor with new schema-based tools', () => {
  const tempDir = createTestTempDir();

  it('executes new schema-based tools correctly', async () => {
    const testDir = await tempDir.getPath();
    const testFile = join(testDir, 'test.txt');
    await writeFile(testFile, 'Line 1\nLine 2\nLine 3\n');

    const executor = new ToolExecutor();
    const tool = new FileReadTool();
    executor.registerTool('file_read', tool);

    const result = await executor.executeTool({
      id: 'test-1',
      name: 'file_read',
      arguments: { path: testFile },
    });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('Line 1\nLine 2\nLine 3\n');
    expect(result.id).toBe('test-1');

    await tempDir.cleanup();
  });

  it('handles validation errors from new tools', async () => {
    const executor = new ToolExecutor();
    const tool = new FileReadTool();
    executor.registerTool('file_read', tool);

    const result = await executor.executeTool({
      id: 'test-2',
      name: 'file_read',
      arguments: { path: '' }, // Invalid empty path
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Validation failed');
    expect(result.content[0].text).toContain('File path cannot be empty');
    expect(result.id).toBe('test-2');
  });

  it('handles line range validation from new tools', async () => {
    const testDir = await tempDir.getPath();
    const testFile = join(testDir, 'test.txt');
    await writeFile(testFile, 'Line 1\nLine 2\nLine 3\n');

    const executor = new ToolExecutor();
    const tool = new FileReadTool();
    executor.registerTool('file_read', tool);

    const result = await executor.executeTool({
      id: 'test-3',
      name: 'file_read',
      arguments: {
        path: testFile,
        startLine: 5,
        endLine: 2, // Invalid range
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('endLine must be >= startLine');
    expect(result.id).toBe('test-3');

    await tempDir.cleanup();
  });
});
