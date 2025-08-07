// ABOUTME: Tests for ToolExecutor with new schema-based tools
// ABOUTME: Validates that new Tool classes work with existing executor infrastructure

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolExecutor } from '~/tools/executor';
import { FileReadTool } from '~/tools/implementations/file-read';
import { ApprovalCallback, ApprovalDecision, ApprovalPendingError } from '~/tools/approval-types';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { createTestTempDir, createMockToolContext } from '~/tools/test-utils';
import { existsSync } from 'fs';
import { clearProcessTempDirCache } from '~/config/lace-dir';
import { z } from 'zod';
import { Tool } from '~/tools/tool';
import type { ToolContext, ToolResult } from '~/tools/types';

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

  describe('ToolExecutor temp directory management', () => {
    let toolExecutor: ToolExecutor;
    let mockTool: MockTool;

    beforeEach(() => {
      toolExecutor = new ToolExecutor();
      mockTool = new MockTool();
      toolExecutor.registerTool(mockTool.name, mockTool);
      toolExecutor.setApprovalCallback(autoApprovalCallback);
      clearProcessTempDirCache();
    });

    it('should provide temp directory to tools', async () => {
      const context = createMockToolContext();
      context.sessionId = 'test-session';
      context.projectId = 'test-project';

      await toolExecutor.executeTool(
        { id: 'test-temp-1', name: 'mock_tool', arguments: { input: 'test' } },
        context
      );

      // Verify tool received temp directory context
      const receivedContext = mockTool.getCapturedContext();
      expect(receivedContext.toolTempDir).toBeDefined();
      expect(existsSync(receivedContext.toolTempDir!)).toBe(true);
    });

    it('should create unique tool call IDs', async () => {
      const context = createMockToolContext();
      context.sessionId = 'test-session';
      context.projectId = 'test-project';

      await toolExecutor.executeTool(
        { id: 'test-temp-2a', name: 'mock_tool', arguments: { input: 'test1' } },
        context
      );
      const context1 = mockTool.getCapturedContext();

      await toolExecutor.executeTool(
        { id: 'test-temp-2b', name: 'mock_tool', arguments: { input: 'test2' } },
        context
      );
      const context2 = mockTool.getCapturedContext();

      expect(context1.toolTempDir).toBeDefined();
      expect(context2.toolTempDir).toBeDefined();
      expect(context1.toolTempDir).not.toBe(context2.toolTempDir);
    });

    it('should create temp directories that exist', async () => {
      const context = createMockToolContext();
      context.sessionId = 'test-session';
      context.projectId = 'test-project';

      await toolExecutor.executeTool(
        { id: 'test-temp-3', name: 'mock_tool', arguments: { input: 'test' } },
        context
      );

      const receivedContext = mockTool.getCapturedContext();
      expect(existsSync(receivedContext.toolTempDir!)).toBe(true);
    });

    it('should throw error when session ID missing', async () => {
      const context = createMockToolContext();
      context.projectId = 'test-project';
      // No sessionId

      const result = await toolExecutor.executeTool(
        { id: 'test-temp-4', name: 'mock_tool', arguments: { input: 'test' } },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Session ID and Project ID required');
    });

    it('should work without temp directories when session/project missing', async () => {
      const context = createMockToolContext();
      // No sessionId or projectId - should work but not create temp directories

      await toolExecutor.executeTool(
        { id: 'test-temp-5', name: 'mock_tool', arguments: { input: 'test' } },
        context
      );

      const receivedContext = mockTool.getCapturedContext();
      expect(receivedContext.toolTempDir).toBeUndefined();
    });
  });
});

// Mock tool for testing temp directory functionality
class MockTool extends Tool {
  name = 'mock_tool';
  description = 'Mock tool for testing';
  schema = z.object({ input: z.string() });

  private capturedContext?: ToolContext;

  protected async executeValidated(
    args: z.infer<typeof this.schema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    this.capturedContext = context;
    return Promise.resolve(this.createResult(`Processed: ${args.input}`));
  }

  getCapturedContext(): ToolContext {
    return this.capturedContext!;
  }
}
