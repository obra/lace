// ABOUTME: Tests for ToolExecutor with new schema-based tools
// ABOUTME: Validates that new Tool classes work with existing executor infrastructure

import { describe, it, expect } from 'vitest';
import { ToolExecutor } from '~/tools/executor';
import { FileReadTool } from '~/tools/implementations/file-read';
import { ApprovalCallback, ApprovalDecision, ApprovalPendingError } from '~/tools/approval-types';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { createTestTempDir, createMockToolContext } from '~/tools/test-utils';

describe('ToolExecutor with new schema-based tools', () => {
  const tempDir = createTestTempDir();

  // Create an approval callback that auto-approves for tests
  const autoApprovalCallback: ApprovalCallback = {
    requestApproval: () => Promise.resolve(ApprovalDecision.ALLOW_ONCE),
  };

  // Create an approval callback that requires approval for tests
  const _requireApprovalCallback: ApprovalCallback = {
    requestApproval: () => Promise.reject(new Error('Approval required')),
  };

  it('executes new schema-based tools correctly', async () => {
    const testDir = await tempDir.getPath();
    const testFile = join(testDir, 'test.txt');
    await writeFile(testFile, 'Line 1\nLine 2\nLine 3\n');

    const executor = new ToolExecutor();
    const tool = new FileReadTool();
    executor.registerTool('file_read', tool);
    executor.setApprovalCallback(autoApprovalCallback);

    const result = await executor.executeTool(
      {
        id: 'test-1',
        name: 'file_read',
        arguments: { path: testFile },
      },
      createMockToolContext()
    );

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('Line 1\nLine 2\nLine 3\n');
    expect(result.id).toBe('test-1');

    await tempDir.cleanup();
  });

  it('handles validation errors from new tools', async () => {
    const executor = new ToolExecutor();
    const tool = new FileReadTool();
    executor.registerTool('file_read', tool);
    executor.setApprovalCallback(autoApprovalCallback);

    const result = await executor.executeTool(
      {
        id: 'test-2',
        name: 'file_read',
        arguments: { path: '' }, // Invalid empty path
      },
      createMockToolContext()
    );

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
    executor.setApprovalCallback(autoApprovalCallback);

    const result = await executor.executeTool(
      {
        id: 'test-3',
        name: 'file_read',
        arguments: {
          path: testFile,
          startLine: 5,
          endLine: 2, // Invalid range
        },
      },
      createMockToolContext()
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('endLine must be >= startLine');
    expect(result.id).toBe('test-3');

    await tempDir.cleanup();
  });

  describe('requestToolPermission method', () => {
    it('should return "granted" when tool is allowed without approval', async () => {
      const executor = new ToolExecutor();
      const tool = new FileReadTool();
      executor.registerTool('file_read', tool);
      executor.setApprovalCallback(autoApprovalCallback);

      const result = await executor.requestToolPermission(
        {
          id: 'test-permission-1',
          name: 'file_read',
          arguments: { path: '/tmp/test.txt' },
        },
        createMockToolContext()
      );

      expect(result).toBe('granted');
    });

    it('should return "pending" when approval callback throws ApprovalPendingError', async () => {
      const pendingCallback: ApprovalCallback = {
        requestApproval: () => {
          throw new ApprovalPendingError('test-permission-2');
        },
      };

      const executor = new ToolExecutor();
      const tool = new FileReadTool();
      executor.registerTool('file_read', tool);
      executor.setApprovalCallback(pendingCallback);

      const result = await executor.requestToolPermission(
        {
          id: 'test-permission-2',
          name: 'file_read',
          arguments: { path: '/tmp/test.txt' },
        },
        createMockToolContext()
      );

      expect(result).toBe('pending');
    });

    it('should throw error when tool does not exist', async () => {
      const executor = new ToolExecutor();
      executor.setApprovalCallback(autoApprovalCallback);

      await expect(
        executor.requestToolPermission(
          {
            id: 'test-permission-3',
            name: 'nonexistent_tool',
            arguments: {},
          },
          createMockToolContext()
        )
      ).rejects.toThrow("Tool 'nonexistent_tool' not found");
    });

    it('should throw error when no approval callback is configured', async () => {
      const executor = new ToolExecutor();
      const tool = new FileReadTool();
      executor.registerTool('file_read', tool);
      // No approval callback set

      await expect(
        executor.requestToolPermission(
          {
            id: 'test-permission-4',
            name: 'file_read',
            arguments: { path: '/tmp/test.txt' },
          },
          createMockToolContext()
        )
      ).rejects.toThrow('Tool execution requires approval but no approval callback is configured');
    });
  });
});
