// ABOUTME: Unit tests for global policy wrapper with TDD approach
// ABOUTME: Tests CLI option policies apply correctly regardless of interface type

import { describe, it, expect, beforeEach } from 'vitest';
import { createGlobalPolicyCallback } from '~/tools/policy-wrapper.js';
import { ApprovalCallback, ApprovalDecision } from '~/tools/approval-types.js';
import { ToolExecutor } from '~/tools/executor.js';
import { CLIOptions } from '~/cli/args.js';
import { BashTool } from '~/tools/implementations/bash.js';
import { FileReadTool } from '~/tools/implementations/file-read.js';
import { FileWriteTool } from '~/tools/implementations/file-write.js';
import { Tool } from '~/tools/tool.js';
import { z } from 'zod';

// Mock interface callback for testing
class MockInterfaceCallback implements ApprovalCallback {
  private responses: Map<string, ApprovalDecision> = new Map();
  public callLog: Array<{ toolName: string; input: unknown }> = [];

  setResponse(toolName: string, decision: ApprovalDecision): void {
    this.responses.set(toolName, decision);
  }

  requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision> {
    this.callLog.push({ toolName, input });
    const response = this.responses.get(toolName);
    if (!response) {
      throw new Error(`No mock response set for tool: ${toolName}`);
    }
    return Promise.resolve(response);
  }

  reset(): void {
    this.responses.clear();
    this.callLog = [];
  }
}

describe('Global Policy Wrapper', () => {
  let toolExecutor: ToolExecutor;
  let mockInterface: MockInterfaceCallback;
  let baseCLIOptions: CLIOptions;

  beforeEach(() => {
    toolExecutor = new ToolExecutor();
    toolExecutor.registerTool('bash', new BashTool());
    toolExecutor.registerTool('file_read', new FileReadTool());
    toolExecutor.registerTool('file_write', new FileWriteTool());

    mockInterface = new MockInterfaceCallback();

    baseCLIOptions = {
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
  });

  describe('policy precedence', () => {
    it('should auto-approve safe internal tools', async () => {
      // Create a mock tool with safeInternal annotation
      class MockSafeTool extends Tool {
        name = 'safe_tool';
        annotations = { safeInternal: true };
        description = 'A safe internal tool';
        schema = z.object({});

        protected executeValidated() {
          return Promise.resolve({
            content: [{ type: 'text' as const, text: 'success' }],
            isError: false,
          });
        }
      }

      const mockSafeTool = new MockSafeTool();
      toolExecutor.registerTool('safe_tool', mockSafeTool);

      const options = baseCLIOptions; // No special policies
      const policyCallback = createGlobalPolicyCallback(mockInterface, options, toolExecutor);

      const result = await policyCallback.requestApproval('safe_tool', { param: 'value' });

      expect(result).toBe(ApprovalDecision.ALLOW_ONCE);
      expect(mockInterface.callLog).toHaveLength(0); // Should not call interface
    });

    it('should deny tools when disableAllTools is true', async () => {
      const options = { ...baseCLIOptions, disableAllTools: true };
      const policyCallback = createGlobalPolicyCallback(mockInterface, options, toolExecutor);

      const result = await policyCallback.requestApproval('bash', { command: 'ls' });

      expect(result).toBe(ApprovalDecision.DENY);
      expect(mockInterface.callLog).toHaveLength(0); // Should not call interface
    });

    it('should deny specific disabled tools', async () => {
      const options = { ...baseCLIOptions, disableTools: ['bash'] };
      const policyCallback = createGlobalPolicyCallback(mockInterface, options, toolExecutor);

      const result = await policyCallback.requestApproval('bash', { command: 'ls' });

      expect(result).toBe(ApprovalDecision.DENY);
      expect(mockInterface.callLog).toHaveLength(0);
    });

    it('should auto-approve all tools when disableToolGuardrails is true', async () => {
      const options = { ...baseCLIOptions, disableToolGuardrails: true };
      const policyCallback = createGlobalPolicyCallback(mockInterface, options, toolExecutor);

      const result = await policyCallback.requestApproval('bash', { command: 'rm -rf /' });

      expect(result).toBe(ApprovalDecision.ALLOW_ONCE);
      expect(mockInterface.callLog).toHaveLength(0);
    });

    it('should auto-approve specific tools in autoApproveTools list', async () => {
      const options = { ...baseCLIOptions, autoApproveTools: ['bash'] };
      const policyCallback = createGlobalPolicyCallback(mockInterface, options, toolExecutor);

      const result = await policyCallback.requestApproval('bash', { command: 'ls' });

      expect(result).toBe(ApprovalDecision.ALLOW_ONCE);
      expect(mockInterface.callLog).toHaveLength(0);
    });

    it('should auto-approve read-only tools when allowNonDestructiveTools is true', async () => {
      const options = { ...baseCLIOptions, allowNonDestructiveTools: true };
      const policyCallback = createGlobalPolicyCallback(mockInterface, options, toolExecutor);

      const result = await policyCallback.requestApproval('file_read', { path: 'test.txt' });

      expect(result).toBe(ApprovalDecision.ALLOW_ONCE);
      expect(mockInterface.callLog).toHaveLength(0);
    });

    it('should prioritize disabled tools over auto-approve', async () => {
      const options = {
        ...baseCLIOptions,
        disableTools: ['bash'],
        autoApproveTools: ['bash'], // Conflicting policy
      };
      const policyCallback = createGlobalPolicyCallback(mockInterface, options, toolExecutor);

      const result = await policyCallback.requestApproval('bash', { command: 'ls' });

      expect(result).toBe(ApprovalDecision.DENY); // Disable should win
      expect(mockInterface.callLog).toHaveLength(0);
    });
  });

  describe('interface callback fallback', () => {
    it('should call interface callback when no policies apply', async () => {
      const options = baseCLIOptions; // No special policies
      const policyCallback = createGlobalPolicyCallback(mockInterface, options, toolExecutor);

      mockInterface.setResponse('bash', ApprovalDecision.ALLOW_ONCE);
      const result = await policyCallback.requestApproval('bash', { command: 'ls' });

      expect(result).toBe(ApprovalDecision.ALLOW_ONCE);
      expect(mockInterface.callLog).toHaveLength(1);
      expect(mockInterface.callLog[0]).toEqual({
        toolName: 'bash',
        input: { command: 'ls' },
      });
    });

    it('should pass through DENY decisions from interface', async () => {
      const options = baseCLIOptions;
      const policyCallback = createGlobalPolicyCallback(mockInterface, options, toolExecutor);

      mockInterface.setResponse('bash', ApprovalDecision.DENY);
      const result = await policyCallback.requestApproval('bash', { command: 'rm -rf /' });

      expect(result).toBe(ApprovalDecision.DENY);
      expect(mockInterface.callLog).toHaveLength(1);
    });

    it('should pass through ALLOW_SESSION decisions from interface', async () => {
      const options = baseCLIOptions;
      const policyCallback = createGlobalPolicyCallback(mockInterface, options, toolExecutor);

      mockInterface.setResponse('file_write', ApprovalDecision.ALLOW_SESSION);
      const result = await policyCallback.requestApproval('file_write', {
        path: 'test.txt',
        content: 'hello',
      });

      expect(result).toBe(ApprovalDecision.ALLOW_SESSION);
      expect(mockInterface.callLog).toHaveLength(1);
    });
  });

  describe('session caching', () => {
    it('should cache ALLOW_SESSION decisions and not call interface again', async () => {
      const options = baseCLIOptions;
      const policyCallback = createGlobalPolicyCallback(mockInterface, options, toolExecutor);

      mockInterface.setResponse('bash', ApprovalDecision.ALLOW_SESSION);

      // First call should trigger interface callback
      const firstResult = await policyCallback.requestApproval('bash', { command: 'ls' });
      expect(firstResult).toBe(ApprovalDecision.ALLOW_SESSION);
      expect(mockInterface.callLog).toHaveLength(1);

      // Second call should use cache
      const secondResult = await policyCallback.requestApproval('bash', { command: 'pwd' });
      expect(secondResult).toBe(ApprovalDecision.ALLOW_SESSION);
      expect(mockInterface.callLog).toHaveLength(1); // Should not increase
    });

    it('should not cache ALLOW_ONCE decisions', async () => {
      const options = baseCLIOptions;
      const policyCallback = createGlobalPolicyCallback(mockInterface, options, toolExecutor);

      mockInterface.setResponse('bash', ApprovalDecision.ALLOW_ONCE);

      // First call
      const firstResult = await policyCallback.requestApproval('bash', { command: 'ls' });
      expect(firstResult).toBe(ApprovalDecision.ALLOW_ONCE);
      expect(mockInterface.callLog).toHaveLength(1);

      // Second call should trigger interface callback again
      const secondResult = await policyCallback.requestApproval('bash', { command: 'pwd' });
      expect(secondResult).toBe(ApprovalDecision.ALLOW_ONCE);
      expect(mockInterface.callLog).toHaveLength(2);
    });

    it('should not cache DENY decisions', async () => {
      const options = baseCLIOptions;
      const policyCallback = createGlobalPolicyCallback(mockInterface, options, toolExecutor);

      mockInterface.setResponse('bash', ApprovalDecision.DENY);

      // First call
      const firstResult = await policyCallback.requestApproval('bash', { command: 'ls' });
      expect(firstResult).toBe(ApprovalDecision.DENY);
      expect(mockInterface.callLog).toHaveLength(1);

      // Second call should trigger interface callback again (user might change mind)
      const secondResult = await policyCallback.requestApproval('bash', { command: 'pwd' });
      expect(secondResult).toBe(ApprovalDecision.DENY);
      expect(mockInterface.callLog).toHaveLength(2);
    });

    it('should maintain separate cache per tool', async () => {
      const options = baseCLIOptions;
      const policyCallback = createGlobalPolicyCallback(mockInterface, options, toolExecutor);

      mockInterface.setResponse('bash', ApprovalDecision.ALLOW_SESSION);
      mockInterface.setResponse('file_write', ApprovalDecision.ALLOW_SESSION);

      // Approve bash for session
      await policyCallback.requestApproval('bash', { command: 'ls' });
      expect(mockInterface.callLog).toHaveLength(1);

      // Approve file_write for session (separate tool, should call interface)
      await policyCallback.requestApproval('file_write', { path: 'test.txt', content: 'hello' });
      expect(mockInterface.callLog).toHaveLength(2);

      // Use bash again (should use cache)
      await policyCallback.requestApproval('bash', { command: 'pwd' });
      expect(mockInterface.callLog).toHaveLength(2);

      // Use file_write again (should use cache)
      await policyCallback.requestApproval('file_write', { path: 'test2.txt', content: 'world' });
      expect(mockInterface.callLog).toHaveLength(2);
    });
  });
});
