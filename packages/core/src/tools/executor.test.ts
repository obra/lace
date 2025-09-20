// ABOUTME: Tests for simplified callback-free ToolExecutor
// ABOUTME: Validates simple execute() interface and tool registry functionality

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolExecutor } from '~/tools/executor';
import { FileReadTool } from '~/tools/implementations/file_read';
import type { ToolCall, ToolContext } from '~/tools/types';

describe('Simplified ToolExecutor', () => {
  let executor: ToolExecutor;
  let mockContext: ToolContext;

  beforeEach(() => {
    executor = new ToolExecutor();
    executor.registerAllAvailableTools(); // Registers all core tools

    mockContext = {
      workingDirectory: '/tmp/test',
      signal: new AbortController().signal,
    };
  });

  describe('Tool Registry', () => {
    it('should register and retrieve tools', () => {
      const tool = new FileReadTool();
      executor.registerTool('test_tool', tool);

      expect(executor.getTool('test_tool')).toBe(tool);
      expect(executor.getTool('nonexistent')).toBeUndefined();
    });

    it('should list available tool names', () => {
      const toolNames = executor.getAvailableToolNames();
      expect(toolNames).toContain('file_read');
      expect(toolNames).toContain('bash');
      expect(Array.isArray(toolNames)).toBe(true);
    });

    it('should get all tools', () => {
      const allTools = executor.getAllTools();
      expect(Array.isArray(allTools)).toBe(true);
      expect(allTools.length).toBeGreaterThan(0);

      const fileReadTool = allTools.find((t) => t.name === 'file_read');
      expect(fileReadTool).toBeDefined();
    });
  });

  describe('Tool Execution', () => {
    it('should execute tools directly', async () => {
      const toolCall: ToolCall = {
        id: 'test-exec-1',
        name: 'file_read',
        arguments: {
          path: '/tmp/nonexistent.txt', // File doesn't need to exist for interface test
        },
      };

      const result = await executor.execute(toolCall, mockContext);

      expect(result).toBeDefined();
      expect(result.id).toBe('test-exec-1');
      expect(result.status).toBeDefined();
    });

    it('should throw error for unknown tools', async () => {
      const toolCall: ToolCall = {
        id: 'test-exec-2',
        name: 'unknown_tool',
        arguments: {},
      };

      await expect(executor.execute(toolCall, mockContext)).rejects.toThrow(
        "Tool 'unknown_tool' not found"
      );
    });

    it('should handle multiple tools independently', async () => {
      const readCall: ToolCall = {
        id: 'read-test',
        name: 'file_read',
        arguments: { path: '/tmp/test1.txt' },
      };

      const bashCall: ToolCall = {
        id: 'bash-test',
        name: 'bash',
        arguments: { command: 'echo test' },
      };

      const readResult = await executor.execute(readCall, mockContext);
      const bashResult = await executor.execute(bashCall, mockContext);

      expect(readResult.id).toBe('read-test');
      expect(bashResult.id).toBe('bash-test');
    });
  });

  describe('Context Enhancement', () => {
    it('should enhance context with temp directory when session available', async () => {
      // This test verifies that the executor properly sets up tool context
      // The actual temp directory creation is tested in integration tests

      const toolCall: ToolCall = {
        id: 'context-test',
        name: 'bash',
        arguments: { command: 'pwd' },
      };

      // Should execute without throwing, even without full session context
      const result = await executor.execute(toolCall, mockContext);
      expect(result).toBeDefined();
    });
  });

  describe('MCP Integration', () => {
    it('should maintain MCP tool discovery methods', () => {
      // These methods exist for MCP integration
      expect(typeof executor.ensureMCPToolsReady).toBe('function');
      expect(typeof executor.registerMCPTools).toBe('function');
    });
  });

  describe('Session Integration', () => {
    it('should support session binding', () => {
      // Session binding is used for temp directories
      expect(typeof executor.setSession).toBe('function');
    });
  });

  describe('No Approval Methods', () => {
    it('should not have approval callback methods', () => {
      // Verify approval methods are completely removed
      expect((executor as any).setApprovalCallback).toBeUndefined();
      expect((executor as any).getApprovalCallback).toBeUndefined();
      expect((executor as any).requestToolPermission).toBeUndefined();
      expect((executor as any).executeApprovedTool).toBeUndefined();
      expect((executor as any).executeTool).toBeUndefined();
    });
  });
});
