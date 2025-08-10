// ABOUTME: Tests for ToolExecutor with new schema-based tools
// ABOUTME: Validates that new Tool classes work with existing executor infrastructure

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolExecutor } from '~/tools/executor';
import { FileReadTool } from '~/tools/implementations/file-read';
import { ApprovalCallback, ApprovalDecision, ApprovalPendingError } from '~/tools/approval-types';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { createTestTempDir } from '~/test-utils/temp-directory';
import { createMockToolContext } from '~/test-utils/mock-session';
import { existsSync } from 'fs';
import { clearProcessTempDirCache } from '~/config/lace-dir';
import { z } from 'zod';
import { Tool } from '~/tools/tool';
import type { ToolContext, ToolResult } from '~/tools/types';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';

describe('ToolExecutor with new schema-based tools', () => {
  const tempDir = createTestTempDir();
  const tempLaceDirContext = setupCoreTest();
  let providerInstanceId: string;

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

    expect(result.status).toBe('completed');
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

    expect(result.status).not.toBe('completed');
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

    expect(result.status).not.toBe('completed');
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
    let session: Session;
    let project: Project;

    beforeEach(async () => {
      setupTestProviderDefaults();
      Session.clearProviderCache();

      // Create provider instance
      providerInstanceId = await createTestProviderInstance({
        catalogId: 'anthropic',
        models: ['claude-3-5-haiku-20241022'],
        displayName: 'Test ToolExecutor Instance',
        apiKey: 'test-anthropic-key',
      });

      // Create real project and session
      project = Project.create(
        'Test Project',
        'Project for temp directory testing',
        tempLaceDirContext.tempDir,
        {
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }
      );

      session = Session.create({
        name: 'Test Session',
        projectId: project.getId(),
      });

      toolExecutor = new ToolExecutor();
      mockTool = new MockTool();
      toolExecutor.registerTool(mockTool.name, mockTool);
      toolExecutor.setApprovalCallback(autoApprovalCallback);
      clearProcessTempDirCache();
    });

    afterEach(async () => {
      cleanupTestProviderDefaults();
      await cleanupTestProviderInstances([providerInstanceId]);
    });

    it('should provide temp directory to tools', async () => {
      const agent = session.getAgent(session.getId());
      if (!agent) throw new Error('Failed to get agent');

      const context: ToolContext = {
        signal: new AbortController().signal,
        agent,
      };

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
      const agent = session.getAgent(session.getId());
      if (!agent) throw new Error('Failed to get agent');

      const context: ToolContext = {
        signal: new AbortController().signal,
        agent,
      };

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
      const agent = session.getAgent(session.getId());
      if (!agent) throw new Error('Failed to get agent');

      const context: ToolContext = {
        signal: new AbortController().signal,
        agent,
      };

      await toolExecutor.executeTool(
        { id: 'test-temp-3', name: 'mock_tool', arguments: { input: 'test' } },
        context
      );

      const receivedContext = mockTool.getCapturedContext();
      expect(existsSync(receivedContext.toolTempDir!)).toBe(true);
    });

    it('should throw error when agent context missing', async () => {
      const context: ToolContext = {
        signal: new AbortController().signal,
        // No agent - should fail temp directory creation
      };

      const result = await toolExecutor.executeTool(
        { id: 'test-temp-4', name: 'mock_tool', arguments: { input: 'test' } },
        context
      );

      expect(result.status).not.toBe('completed');
      expect(result.content[0].text).toContain(
        'agent context required for security policy enforcement'
      );
    });

    it('should require agent context for security policy enforcement', async () => {
      const context: ToolContext = {
        signal: new AbortController().signal,
      };
      // No agent - should fail due to security policy

      const result = await toolExecutor.executeTool(
        { id: 'test-temp-5', name: 'mock_tool', arguments: { input: 'test' } },
        context
      );

      // Should fail due to security requirement
      expect(result.status).not.toBe('completed');
      expect(result.content[0].text).toContain(
        'agent context required for security policy enforcement'
      );
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
