// ABOUTME: Tests for agent-owned approval orchestration methods
// ABOUTME: Verifies Agent controls its entire tool execution and approval pipeline

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from './agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { DatabasePersistence } from '~/persistence/database';
import type { ToolCall } from '~/tools/types';

// Mock Session for policy checking
const mockSession = {
  getToolPolicy: vi.fn(),
  getEffectiveConfiguration: vi.fn().mockReturnValue({ tools: undefined }), // No tool restrictions by default
  getProjectId: vi.fn().mockReturnValue('test-project'),
  getEnvironmentVariables: vi.fn().mockReturnValue({}),
  createToolTempDirectory: vi.fn().mockReturnValue('/tmp/test-tool-dir'),
};

describe('Agent Approval Orchestration', () => {
  let agent: Agent;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    const persistence = new DatabasePersistence(':memory:');
    threadManager = new ThreadManager();
    toolExecutor = new ToolExecutor();

    agent = new Agent({
      threadId: 'test-agent-thread',
      threadManager,
      toolExecutor,
      tools: [],
      metadata: {
        name: 'Test Agent',
        modelId: 'test-model',
        providerInstanceId: 'test-provider',
      },
    });

    // Mock session for policy checking
    vi.spyOn(agent, 'getFullSession').mockResolvedValue(mockSession as any);
  });

  describe('Tool Permission Checking', () => {
    it('should grant permission for tools with "allow" policy', async () => {
      mockSession.getToolPolicy.mockReturnValue('allow');

      const permission = await (agent as any)._checkToolPermission({
        name: 'allowed_tool',
        id: 'test-call-1',
        arguments: {},
      });

      expect(permission).toBe('granted');
    });

    it('should deny permission for tools with "deny" policy', async () => {
      mockSession.getToolPolicy.mockReturnValue('deny');

      const permission = await (agent as any)._checkToolPermission({
        name: 'denied_tool',
        id: 'test-call-2',
        arguments: {},
      });

      expect(permission).toBe('denied');
    });

    it('should require approval for tools with "ask" policy', async () => {
      mockSession.getToolPolicy.mockReturnValue('ask');

      const permission = await (agent as any)._checkToolPermission({
        name: 'ask_tool',
        id: 'test-call-3',
        arguments: {},
      });

      expect(permission).toBe('approval_required');
    });

    it('should default to approval_required for unknown policies', async () => {
      mockSession.getToolPolicy.mockReturnValue(undefined);

      const permission = await (agent as any)._checkToolPermission({
        name: 'unknown_tool',
        id: 'test-call-4',
        arguments: {},
      });

      expect(permission).toBe('approval_required');
    });

    it('should deny when session context is missing (fail-closed)', async () => {
      // Mock getFullSession to return null (no session context)
      vi.spyOn(agent, 'getFullSession').mockResolvedValue(null);

      const permission = await (agent as any)._checkToolPermission({
        name: 'any_tool',
        id: 'test-call-5',
        arguments: {},
      });

      expect(permission).toBe('denied');
    });

    it('should deny tools not in session configuration allowlist', async () => {
      // Mock session with restricted tool configuration
      const restrictedSession = {
        getToolPolicy: vi.fn().mockReturnValue(undefined), // No specific policy
        getEffectiveConfiguration: vi.fn().mockReturnValue({
          tools: ['allowed_tool'], // Only one tool allowed
        }),
      };
      vi.spyOn(agent, 'getFullSession').mockResolvedValue(restrictedSession as any);

      const permission = await (agent as any)._checkToolPermission({
        name: 'restricted_tool', // Not in allowlist
        id: 'test-call-6',
        arguments: {},
      });

      // Should be denied even if no explicit deny policy
      expect(permission).toBe('denied');
    });
  });

  describe('Approval Flow Orchestration', () => {
    it('should create approval request event in correct thread', async () => {
      const toolCall: ToolCall = {
        id: 'approval-test-1',
        name: 'test_tool',
        arguments: {},
      };

      // Mock agent methods
      const addEventSpy = vi.spyOn(agent as any, '_addEventAndEmit').mockImplementation(() => {});
      const waitForApprovalSpy = vi
        .spyOn(agent as any, '_waitForApprovalDecision')
        .mockResolvedValue('allow_once');
      const executeSpy = vi.spyOn(toolExecutor, 'execute').mockResolvedValue({
        id: 'approval-test-1',
        content: [{ type: 'text', text: 'Tool executed successfully' }],
        status: 'completed',
      });

      await (agent as any)._handleToolApprovalFlow(toolCall, { agent });

      // Should create approval request event
      expect(addEventSpy).toHaveBeenNthCalledWith(1, {
        type: 'TOOL_APPROVAL_REQUEST',
        data: { toolCallId: 'approval-test-1' },
        context: {
          threadId: 'test-agent-thread',
          sessionId: undefined, // Test agent doesn't have session context
        },
      });

      // Should wait for approval
      expect(waitForApprovalSpy).toHaveBeenCalledWith('approval-test-1');

      // Should execute tool after approval
      expect(executeSpy).toHaveBeenCalledWith(toolCall, { agent });
    });

    it('should handle denied approvals properly', async () => {
      const toolCall: ToolCall = {
        id: 'denial-test-1',
        name: 'test_tool',
        arguments: {},
      };

      // Mock denial response
      vi.spyOn(agent as any, '_addEventAndEmit').mockImplementation(() => {});
      vi.spyOn(agent as any, '_waitForApprovalDecision').mockResolvedValue('deny');
      const executeSpy = vi.spyOn(toolExecutor, 'execute');

      await (agent as any)._handleToolApprovalFlow(toolCall, { agent });

      // Should NOT execute tool after denial
      expect(executeSpy).not.toHaveBeenCalled();
    });
  });

  describe('External Approval Response Handling', () => {
    it('should write approval response event when handleApprovalResponse is called', async () => {
      const addEventSpy = vi.spyOn(agent as any, '_addEventAndEmit').mockImplementation(() => {});

      await agent.handleApprovalResponse('test-tool-call-1', 'allow_once' as any);

      expect(addEventSpy).toHaveBeenCalledWith({
        type: 'TOOL_APPROVAL_RESPONSE',
        data: { toolCallId: 'test-tool-call-1', decision: 'allow_once' },
        context: {
          threadId: 'test-agent-thread',
          // sessionId not included in test context
        },
      });
    });
  });
});
