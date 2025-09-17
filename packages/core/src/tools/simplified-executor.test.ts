// ABOUTME: Tests for simplified callback-free ToolExecutor interface
// ABOUTME: Verifies ToolExecutor focuses only on tool execution without approval complexity

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolExecutor } from './executor';
import { FileReadTool } from './implementations/file-read';
import type { ToolCall, ToolContext } from './types';

describe('Simplified ToolExecutor (Callback-Free)', () => {
  let executor: ToolExecutor;
  let mockContext: ToolContext;

  beforeEach(() => {
    executor = new ToolExecutor();
    executor.registerTool('file_read', new FileReadTool());

    mockContext = {
      workingDirectory: '/tmp/test',
      signal: new AbortController().signal,
      // No agent needed for simplified execution
    };
  });

  it('should execute tools directly without approval complexity', async () => {
    const toolCall: ToolCall = {
      id: 'test-call-1',
      name: 'file_read',
      arguments: {
        path: '/tmp/nonexistent.txt', // File doesn't need to exist for basic interface test
      },
    };

    // ToolExecutor should just execute - no approval checking
    const result = await executor.execute(toolCall, mockContext);

    expect(result).toBeDefined();
    expect(result.id).toBe('test-call-1');
    // Tool execution details tested in individual tool tests
  });

  it('should throw error for unknown tools', async () => {
    const toolCall: ToolCall = {
      id: 'test-call-2',
      name: 'nonexistent_tool',
      arguments: {},
    };

    await expect(executor.execute(toolCall, mockContext)).rejects.toThrow(
      "Tool 'nonexistent_tool' not found"
    );
  });

  it('should not have any approval callback methods', () => {
    // These methods should not exist in the simplified interface
    expect((executor as any).setApprovalCallback).toBeUndefined();
    expect((executor as any).getApprovalCallback).toBeUndefined();
    expect((executor as any).requestToolPermission).toBeUndefined();
    expect((executor as any).executeApprovedTool).toBeUndefined();
    expect((executor as any).executeTool).toBeUndefined(); // deprecated method
  });

  it('should still have tool registry methods', () => {
    // Core tool management should remain
    expect(typeof executor.getTool).toBe('function');
    expect(typeof executor.registerTool).toBe('function');
    expect(typeof executor.getAllTools).toBe('function');
  });

  it('should handle tool execution errors properly', async () => {
    const toolCall: ToolCall = {
      id: 'test-call-3',
      name: 'file_read',
      arguments: {
        path: '/invalid/path/that/definitely/does/not/exist.txt',
      },
    };

    // FileReadTool returns error results instead of throwing
    const result = await executor.execute(toolCall, mockContext);
    expect(result.status).toBe('failed');
    expect(result.id).toBe('test-call-3');
  });

  it('should support multiple tools without interference', async () => {
    // Register another tool
    executor.registerTool(
      'file_write',
      new (class MockFileWriteTool {
        name = 'file_write';
        description = 'Mock write tool';
        schema = {} as any;
        annotations = {};

        async executeValidated(args: any, context: ToolContext) {
          return {
            // ToolExecutor should set the ID from the tool call
            content: [{ type: 'text', text: 'File written successfully' }],
            status: 'completed' as const,
          };
        }
      })() as any
    );

    const readCall: ToolCall = {
      id: 'read-test',
      name: 'file_read',
      arguments: { path: '/tmp/test.txt' },
    };

    const writeCall: ToolCall = {
      id: 'write-test',
      name: 'file_write',
      arguments: { file_path: '/tmp/out.txt', content: 'test' },
    };

    // Both should execute independently
    const readResult = await executor.execute(readCall, mockContext);
    const writeResult = await executor.execute(writeCall, mockContext);

    expect(readResult.id).toBe('read-test');
    expect(writeResult.id).toBe('write-test');
  });
});
