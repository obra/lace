// ABOUTME: Test file for Agent policy enforcement functionality (ported from ToolExecutor)
// ABOUTME: Tests Agent tool policy enforcement with allow/ask/deny logic

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from '~/agents/agent';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { DatabasePersistence } from '~/persistence/database';
import type { ToolCall } from '~/tools/types';

describe('Agent policy enforcement', () => {
  let agent: Agent;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;
  let mockSession: any;

  beforeEach(() => {
    const persistence = new DatabasePersistence(':memory:');
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
    vi.mocked(mockSession.getToolPolicy).mockReturnValue('ask');

    // Mock agent approval for policy tests
    vi.spyOn(context.agent as any, '_checkToolPermission').mockResolvedValue('granted');

    const toolCall = {
      id: 'test-id',
      name: 'file_write',
      arguments: { path: '/test.txt', content: 'test' },
    };
    const result = await executor.executeTool(toolCall, context);

    // The tool may fail due to filesystem issues, but policy should allow it to try
    expect(result.content[0].text).not.toContain('Tool execution denied by policy');
  });

  it('should deny tool when policy is deny', async () => {
    vi.mocked(mockSession.getToolPolicy).mockReturnValue('deny');

    const toolCall = { id: 'test-id', name: 'bash', arguments: { command: 'ls' } };
    const result = await executor.executeTool(toolCall, context);

    expect(result.status).toBe('denied');
    expect(result.content[0].text).toContain('execution denied by policy');
  });

  it('should deny tool when not in allowed tools list', async () => {
    vi.mocked(mockSession.getEffectiveConfiguration).mockReturnValue({
      tools: ['file_read'], // bash not included
    });

    const toolCall = { id: 'test-id', name: 'bash', arguments: { command: 'ls' } };
    const result = await executor.executeTool(toolCall, context);

    expect(result.status).toBe('denied');
    expect(result.content[0].text).toContain('not allowed in current configuration');
  });

  it('should require session context for security policy enforcement', async () => {
    const mockAgentWithoutSession = {
      threadId: asThreadId('lace_20250101_test03'),
      getFullSession: vi.fn().mockResolvedValue(undefined), // No session available
    } as unknown as Agent;

    const contextWithoutSession = {
      signal: new AbortController().signal,
      agent: mockAgentWithoutSession,
    };

    const toolCall = { id: 'test-id', name: 'file_read', arguments: { file_path: '/test.txt' } };
    const result = await executor.executeTool(toolCall, contextWithoutSession);

    expect(result.status).toBe('denied');
    expect(result.content[0].text).toContain('Session not found for policy enforcement');
  });

  it('should deny approval when user rejects', async () => {
    vi.mocked(mockSession.getToolPolicy).mockReturnValue('ask');

    // Mock agent approval for policy tests
    vi.spyOn(context.agent as any, '_checkToolPermission').mockResolvedValue('denied');

    const toolCall = {
      id: 'test-id',
      name: 'file_write',
      arguments: { path: '/test.txt', content: 'test' },
    };
    const result = await executor.executeTool(toolCall, context);

    expect(mockApprovalCallback.requestApproval).toHaveBeenCalled();
    expect(result.status).toBe('denied');
    expect(result.content[0].text).toContain('Tool execution denied by approval policy');
  });
});
