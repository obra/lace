// ABOUTME: End-to-end integration tests for simplified tool approval system
// ABOUTME: Tests complete approval flow from CLI options through policy wrapper to tool execution

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolExecutor } from '~/tools/executor';
import { createGlobalPolicyCallback } from '~/tools/policy-wrapper';
import { ApprovalCallback, ApprovalDecision } from '~/tools/approval-types';
import { CLIOptions } from '~/cli/args';
import { BashTool } from '~/tools/implementations/bash';
import { FileReadTool } from '~/tools/implementations/file-read';
import { FileWriteTool } from '~/tools/implementations/file-write';
import { ToolCall, ToolContext } from '~/tools/types';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import {
  setupTestProviderInstances,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import { ThreadId } from '~/threads/types';

// Mock approval interface for testing
class MockApprovalInterface implements ApprovalCallback {
  private responses: Map<string, ApprovalDecision> = new Map();
  public callLog: Array<{ toolName: string; input: unknown }> = [];

  setResponse(toolName: string, decision: ApprovalDecision): void {
    this.responses.set(toolName, decision);
  }

  requestApproval(toolCall: {
    id: string;
    name: string;
    arguments: unknown;
  }): Promise<ApprovalDecision> {
    this.callLog.push({ toolName: toolCall.name, input: toolCall.arguments });
    const response = this.responses.get(toolCall.name);
    if (!response) {
      return Promise.resolve(ApprovalDecision.DENY); // Default to deny if no response set
    }
    return Promise.resolve(response);
  }

  reset(): void {
    this.responses.clear();
    this.callLog = [];
  }
}

// Helper function to create ToolCall objects
function createToolCall(
  name: string,
  args: Record<string, unknown>,
  id: string = 'test-id'
): ToolCall {
  return {
    id,
    name,
    arguments: args,
  };
}

describe('Tool Approval System Integration', () => {
  const tempDirContext = useTempLaceDir();
  let toolExecutor: ToolExecutor;
  let mockInterface: MockApprovalInterface;
  let session: Session;
  let project: Project;
  let toolContext: ToolContext;
  let testProviderInstances: {
    anthropicInstanceId: string;
    openaiInstanceId: string;
  };

  beforeEach(async () => {
    setupTestPersistence();
    testProviderInstances = await setupTestProviderInstances();

    // Create real project and session for proper tool execution context
    project = Project.create(
      'Tool Approval Test Project',
      'Project for tool approval integration testing',
      tempDirContext.tempDir,
      {
        tools: ['bash', 'file_read', 'file_write'], // Enable tools for testing
        toolPolicies: {
          // All tools require approval by default
          bash: 'require-approval',
          file_read: 'require-approval',
          file_write: 'require-approval',
        },
      }
    );

    session = Session.create({
      name: 'Tool Approval Test Session',
      providerInstanceId: testProviderInstances.anthropicInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      projectId: project.getId(),
    });

    // Create tool context with session for security policy enforcement
    toolContext = {
      threadId: 'test-thread-id' as ThreadId,
      parentThreadId: 'test-parent-thread-id' as ThreadId,
      workingDirectory: tempDirContext.tempDir,
      session, // REQUIRED for security policy enforcement
    };

    toolExecutor = new ToolExecutor();
    toolExecutor.registerTool('bash', new BashTool());
    toolExecutor.registerTool('file_read', new FileReadTool());
    toolExecutor.registerTool('file_write', new FileWriteTool());

    mockInterface = new MockApprovalInterface();
  });

  afterEach(async () => {
    mockInterface.reset();
    teardownTestPersistence();
    await cleanupTestProviderInstances([
      testProviderInstances.anthropicInstanceId,
      testProviderInstances.openaiInstanceId,
    ]);
  });

  describe('complete approval flow without policies', () => {
    it('should execute tool when interface approves with ALLOW_ONCE', async () => {
      toolExecutor.setApprovalCallback(mockInterface);
      mockInterface.setResponse('bash', ApprovalDecision.ALLOW_ONCE);

      const result = await toolExecutor.executeTool(
        createToolCall('bash', { command: 'echo "test"' }),
        toolContext
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('test');
      expect(mockInterface.callLog).toHaveLength(1);
      expect(mockInterface.callLog[0]).toEqual({
        toolName: 'bash',
        input: { command: 'echo "test"' },
      });
    });

    it('should deny tool execution when interface denies', async () => {
      toolExecutor.setApprovalCallback(mockInterface);
      mockInterface.setResponse('bash', ApprovalDecision.DENY);

      const result = await toolExecutor.executeTool(
        createToolCall('bash', { command: 'echo "test"' }),
        toolContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Tool execution denied by approval policy');
      expect(mockInterface.callLog).toHaveLength(1);
    });

    it('should fail safely when no approval callback is set', async () => {
      // No approval callback set - should fail safely
      const result = await toolExecutor.executeTool(
        createToolCall('bash', { command: 'echo "no approval"' }),
        toolContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        'Tool execution requires approval but no approval callback is configured'
      );
      expect(mockInterface.callLog).toHaveLength(0);
    });
  });

  describe('global policy integration', () => {
    it('should auto-approve tools in autoApproveTools list without calling interface', async () => {
      const cliOptions: CLIOptions = {
        provider: 'anthropic',
        model: undefined,
        help: false,
        logLevel: 'info',
        logFile: undefined,
        prompt: undefined,
        ui: 'terminal',
        allowNonDestructiveTools: false,
        autoApproveTools: ['bash'],
        disableTools: [],
        disableAllTools: false,
        disableToolGuardrails: false,
        listTools: false,
      };

      const policyCallback = createGlobalPolicyCallback(mockInterface, cliOptions, toolExecutor);
      toolExecutor.setApprovalCallback(policyCallback);

      const result = await toolExecutor.executeTool(
        createToolCall('bash', { command: 'echo "auto-approved"' }),
        toolContext
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('auto-approved');
      expect(mockInterface.callLog).toHaveLength(0); // Interface should not be called
    });

    it('should deny tools in disableTools list without calling interface', async () => {
      const cliOptions: CLIOptions = {
        provider: 'anthropic',
        model: undefined,
        help: false,
        logLevel: 'info',
        logFile: undefined,
        prompt: undefined,
        ui: 'terminal',
        allowNonDestructiveTools: false,
        autoApproveTools: [],
        disableTools: ['bash'],
        disableAllTools: false,
        disableToolGuardrails: false,
        listTools: false,
      };

      const policyCallback = createGlobalPolicyCallback(mockInterface, cliOptions, toolExecutor);
      toolExecutor.setApprovalCallback(policyCallback);

      const result = await toolExecutor.executeTool(
        createToolCall('bash', { command: 'echo "blocked"' }),
        toolContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Tool execution denied by approval policy');
      expect(mockInterface.callLog).toHaveLength(0); // Interface should not be called
    });

    it('should auto-approve read-only tools when allowNonDestructiveTools is true', async () => {
      const cliOptions: CLIOptions = {
        provider: 'anthropic',
        model: undefined,
        help: false,
        logLevel: 'info',
        logFile: undefined,
        prompt: undefined,
        ui: 'terminal',
        allowNonDestructiveTools: true,
        autoApproveTools: [],
        disableTools: [],
        disableAllTools: false,
        disableToolGuardrails: false,
        listTools: false,
      };

      // Create a test file first
      const fs = await import('fs/promises');
      await fs.writeFile('/tmp/safe-read-test.txt', 'safe content');

      const policyCallback = createGlobalPolicyCallback(mockInterface, cliOptions, toolExecutor);
      toolExecutor.setApprovalCallback(policyCallback);

      const result = await toolExecutor.executeTool(
        createToolCall('file_read', {
          path: '/tmp/safe-read-test.txt',
        }),
        toolContext
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('safe content');
      expect(mockInterface.callLog).toHaveLength(0); // Interface should not be called

      // Clean up
      await fs.unlink('/tmp/safe-read-test.txt');
    });

    it('should fall back to interface approval when no policies apply', async () => {
      const cliOptions: CLIOptions = {
        provider: 'anthropic',
        model: undefined,
        help: false,
        logLevel: 'info',
        logFile: undefined,
        prompt: undefined,
        ui: 'terminal',
        allowNonDestructiveTools: false, // Don't auto-approve read-only
        autoApproveTools: [], // No auto-approved tools
        disableTools: [], // No disabled tools
        disableAllTools: false,
        disableToolGuardrails: false,
        listTools: false,
      };

      const policyCallback = createGlobalPolicyCallback(mockInterface, cliOptions, toolExecutor);
      toolExecutor.setApprovalCallback(policyCallback);

      mockInterface.setResponse('bash', ApprovalDecision.ALLOW_ONCE);
      const result = await toolExecutor.executeTool(
        createToolCall('bash', {
          command: 'echo "interface decision"',
        }),
        toolContext
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('interface decision');
      expect(mockInterface.callLog).toHaveLength(1); // Interface should be called
    });
  });

  describe('session caching integration', () => {
    it('should cache ALLOW_SESSION decisions across multiple tool executions', async () => {
      const cliOptions: CLIOptions = {
        provider: 'anthropic',
        model: undefined,
        help: false,
        logLevel: 'info',
        logFile: undefined,
        prompt: undefined,
        ui: 'terminal',
        allowNonDestructiveTools: false,
        autoApproveTools: [],
        disableTools: [],
        disableAllTools: false,
        disableToolGuardrails: false,
        listTools: false,
      };

      const policyCallback = createGlobalPolicyCallback(mockInterface, cliOptions, toolExecutor);
      toolExecutor.setApprovalCallback(policyCallback);

      mockInterface.setResponse('bash', ApprovalDecision.ALLOW_SESSION);

      // First execution should call interface
      const firstResult = await toolExecutor.executeTool(
        createToolCall('bash', { command: 'echo "first"' }),
        toolContext
      );
      expect(firstResult.isError).toBe(false);
      expect(firstResult.content[0].text).toContain('first');
      expect(mockInterface.callLog).toHaveLength(1);

      // Second execution should use cached approval
      const secondResult = await toolExecutor.executeTool(
        createToolCall('bash', { command: 'echo "second"' }),
        toolContext
      );
      expect(secondResult.isError).toBe(false);
      expect(secondResult.content[0].text).toContain('second');
      expect(mockInterface.callLog).toHaveLength(1); // Should not increase
    });
  });

  describe('policy precedence integration', () => {
    it('should prioritize disableTools over autoApproveTools', async () => {
      const cliOptions: CLIOptions = {
        provider: 'anthropic',
        model: undefined,
        help: false,
        logLevel: 'info',
        logFile: undefined,
        prompt: undefined,
        ui: 'terminal',
        allowNonDestructiveTools: false,
        autoApproveTools: ['bash'], // Try to auto-approve
        disableTools: ['bash'], // But also disable
        disableAllTools: false,
        disableToolGuardrails: false,
        listTools: false,
      };

      const policyCallback = createGlobalPolicyCallback(mockInterface, cliOptions, toolExecutor);
      toolExecutor.setApprovalCallback(policyCallback);

      const result = await toolExecutor.executeTool(
        createToolCall('bash', {
          command: 'echo "should be blocked"',
        }),
        toolContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Tool execution denied by approval policy');
      expect(mockInterface.callLog).toHaveLength(0); // Interface should not be called
    });

    it('should prioritize disableAllTools over all other policies', async () => {
      const cliOptions: CLIOptions = {
        provider: 'anthropic',
        model: undefined,
        help: false,
        logLevel: 'info',
        logFile: undefined,
        prompt: undefined,
        ui: 'terminal',
        allowNonDestructiveTools: true, // Try to allow read-only
        autoApproveTools: ['bash'], // Try to auto-approve
        disableTools: [],
        disableAllTools: true, // But disable everything
        disableToolGuardrails: false,
        listTools: false,
      };

      const policyCallback = createGlobalPolicyCallback(mockInterface, cliOptions, toolExecutor);
      toolExecutor.setApprovalCallback(policyCallback);

      // Test bash (should be blocked despite auto-approve)
      const bashResult = await toolExecutor.executeTool(
        createToolCall('bash', { command: 'echo "blocked"' }),
        toolContext
      );
      expect(bashResult.isError).toBe(true);

      // Test file_read (should be blocked despite read-only)
      const fileReadResult = await toolExecutor.executeTool(
        createToolCall('file_read', { path: 'test.txt' }),
        toolContext
      );
      expect(fileReadResult.isError).toBe(true);

      expect(mockInterface.callLog).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('should handle approval callback errors gracefully', async () => {
      const errorCallback: ApprovalCallback = {
        requestApproval(): Promise<ApprovalDecision> {
          return Promise.reject(new Error('Approval system failed'));
        },
      };

      toolExecutor.setApprovalCallback(errorCallback);

      const result = await toolExecutor.executeTool(
        createToolCall('bash', { command: 'echo "error test"' }),
        toolContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Approval system failed');
    });

    it('should handle unknown tools gracefully', async () => {
      toolExecutor.setApprovalCallback(mockInterface);

      const result = await toolExecutor.executeTool(
        createToolCall('unknown_tool', { param: 'value' }),
        toolContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Tool 'unknown_tool' not found");
      expect(mockInterface.callLog).toHaveLength(0); // Should not call approval for unknown tools
    });
  });
});
