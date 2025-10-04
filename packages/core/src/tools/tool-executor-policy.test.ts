// ABOUTME: Test file for Agent policy enforcement functionality (ported from ToolExecutor)
// ABOUTME: Tests Agent tool policy enforcement with allow/ask/deny logic

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from '@lace/core/agents/agent';
import { ToolExecutor } from './executor';
import { ThreadManager } from '@lace/core/threads/thread-manager';
import type { ToolCall } from './types';

describe('Agent policy enforcement', () => {
  let agent: Agent;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;
  let mockSession: any;

  beforeEach(() => {
    threadManager = new ThreadManager();
    toolExecutor = new ToolExecutor();

    // Create test agent
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

    // Mock session with different tool policies for testing
    mockSession = {
      getToolPolicy: vi.fn(),
      getEffectiveConfiguration: vi.fn().mockReturnValue({
        tools: ['file_read', 'file_write', 'bash'], // Tools in allowlist
      }),
    };

    // Mock agent's session access
    vi.spyOn(agent, 'getFullSession').mockResolvedValue(mockSession);
  });

  it('should allow tool when policy is allow', async () => {
    mockSession.getToolPolicy.mockReturnValue('allow');

    const toolCall: ToolCall = {
      id: 'test-id',
      name: 'file_read',
      arguments: { path: '/test.txt' },
    };

    const permission = await (
      agent as unknown as { _checkToolPermission: (toolCall: ToolCall) => Promise<string> }
    )._checkToolPermission(toolCall);

    expect(permission).toBe('granted');
  });

  it('should require approval when policy is ask', async () => {
    mockSession.getToolPolicy.mockReturnValue('ask');

    const toolCall: ToolCall = {
      id: 'test-id',
      name: 'file_write',
      arguments: { path: '/test.txt', content: 'test' },
    };

    const permission = await (
      agent as unknown as { _checkToolPermission: (toolCall: ToolCall) => Promise<string> }
    )._checkToolPermission(toolCall);

    expect(permission).toBe('approval_required');
  });

  it('should deny tool when policy is deny', async () => {
    mockSession.getToolPolicy.mockReturnValue('deny');

    const toolCall: ToolCall = {
      id: 'test-id',
      name: 'bash',
      arguments: { command: 'ls' },
    };

    const permission = await (
      agent as unknown as { _checkToolPermission: (toolCall: ToolCall) => Promise<string> }
    )._checkToolPermission(toolCall);

    expect(permission).toBe('denied');
  });

  it('should deny tool when not in allowed tools list', async () => {
    mockSession.getEffectiveConfiguration.mockReturnValue({
      tools: ['file_read'], // bash not included
    });
    mockSession.getToolPolicy.mockReturnValue('allow'); // Policy allows but not in allowlist

    const toolCall: ToolCall = {
      id: 'test-id',
      name: 'bash',
      arguments: { command: 'ls' },
    };

    const permission = await (
      agent as unknown as { _checkToolPermission: (toolCall: ToolCall) => Promise<string> }
    )._checkToolPermission(toolCall);

    expect(permission).toBe('denied');
  });

  it('should require session context for security policy enforcement', async () => {
    // Mock getFullSession to return null (no session available)
    vi.spyOn(agent, 'getFullSession').mockResolvedValue(null);

    const toolCall: ToolCall = {
      id: 'test-id',
      name: 'file_read',
      arguments: { path: '/test.txt' },
    };

    const permission = await (
      agent as unknown as { _checkToolPermission: (toolCall: ToolCall) => Promise<string> }
    )._checkToolPermission(toolCall);

    expect(permission).toBe('denied');
  });

  it('should handle denied approvals correctly', async () => {
    mockSession.getToolPolicy.mockReturnValue('ask');

    const toolCall: ToolCall = {
      id: 'test-id',
      name: 'file_write',
      arguments: { path: '/test.txt', content: 'test' },
    };

    // First check should return approval_required
    const permission = await (
      agent as unknown as { _checkToolPermission: (toolCall: ToolCall) => Promise<string> }
    )._checkToolPermission(toolCall);
    expect(permission).toBe('approval_required');

    // Test that denied approval creates proper result
    const deniedResult = (
      agent as unknown as { _createDeniedResult: (toolCall: ToolCall, decision: string) => any }
    )._createDeniedResult(toolCall, 'deny');
    expect(deniedResult.status).toBe('failed');
    expect(deniedResult.content[0].text).toContain('Tool execution denied: deny');
  });
});
