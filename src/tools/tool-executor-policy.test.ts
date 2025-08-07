// ABOUTME: Test file for ToolExecutor policy enforcement functionality
// ABOUTME: Tests tool policy enforcement with allow/require-approval/deny logic

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToolExecutor } from '~/tools/executor';
import { ToolContext } from '~/tools/types';
import { ApprovalDecision } from '~/tools/approval-types';
import { asThreadId } from '~/threads/types';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { BashTool } from '~/tools/implementations/bash';
import { FileReadTool } from '~/tools/implementations/file-read';
import { FileWriteTool } from '~/tools/implementations/file-write';
import { setupCoreTest } from '~/test-utils/core-test-setup';

describe('ToolExecutor policy enforcement', () => {
  const _tempLaceDir = setupCoreTest();
  let executor: ToolExecutor;
  let project: Project;
  let projectId: string;
  let context: ToolContext;
  let mockSession: Session;

  beforeEach(() => {
    // Create a test project with tool policies
    project = Project.create('Test Project', '/project/path', 'A test project', {
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      tools: ['file-read', 'file-write', 'bash'],
      toolPolicies: {
        'file-read': 'allow',
        'file-write': 'require-approval',
        bash: 'deny',
      },
    });
    projectId = project.getId();

    // Create executor and register tools
    executor = new ToolExecutor();
    executor.registerTool('bash', new BashTool());
    executor.registerTool('file-read', new FileReadTool());
    executor.registerTool('file-write', new FileWriteTool());

    // Create mock session that implements getToolPolicy
    mockSession = {
      getToolPolicy: vi.fn(),
      getEffectiveConfiguration: vi.fn().mockReturnValue({
        tools: ['file-read', 'file-write', 'bash'],
        toolPolicies: {
          'file-read': 'allow',
          'file-write': 'require-approval',
          bash: 'deny',
        },
      }),
    } as unknown as Session;

    context = {
      threadId: asThreadId('lace_20250101_test03'),
      parentThreadId: asThreadId('lace_20250101_sess01'),
      workingDirectory: '/project/path',
      sessionId: 'lace_20250101_sess01',
      projectId: projectId,
      session: mockSession,
    };
  });

  afterEach(() => {
    // Test cleanup handled by setupCoreTest
  });

  it('should allow tool when policy is allow', async () => {
    vi.mocked(mockSession.getToolPolicy).mockReturnValue('allow');

    const toolCall = { id: 'test-id', name: 'file-read', arguments: { file_path: '/test.txt' } };
    const result = await executor.executeTool(toolCall, context);

    // Policy should allow the tool to execute (not be denied by policy)
    expect(result.content[0].text).not.toContain('Tool execution denied by policy');
  });

  it('should require approval when policy is require-approval', async () => {
    vi.mocked(mockSession.getToolPolicy).mockReturnValue('require-approval');

    // Mock approval system to auto-approve
    const mockApprovalCallback = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalDecision.ALLOW_ONCE),
    };
    executor.setApprovalCallback(mockApprovalCallback);

    const toolCall = {
      id: 'test-id',
      name: 'file-write',
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

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('execution denied by policy');
  });

  it('should deny tool when not in allowed tools list', async () => {
    vi.mocked(mockSession.getEffectiveConfiguration).mockReturnValue({
      tools: ['file-read'], // bash not included
    });

    const toolCall = { id: 'test-id', name: 'bash', arguments: { command: 'ls' } };
    const result = await executor.executeTool(toolCall, context);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not allowed in current configuration');
  });

  it('should require session context for security policy enforcement', async () => {
    const contextWithoutSession = {
      threadId: asThreadId('lace_20250101_test03'),
    };

    const toolCall = { id: 'test-id', name: 'file-read', arguments: { file_path: '/test.txt' } };
    const result = await executor.executeTool(toolCall, contextWithoutSession);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      'session context required for security policy enforcement'
    );
  });

  it('should deny approval when user rejects', async () => {
    vi.mocked(mockSession.getToolPolicy).mockReturnValue('require-approval');

    // Mock approval system to reject
    const mockApprovalCallback = {
      requestApproval: vi.fn().mockResolvedValue(ApprovalDecision.DENY),
    };
    executor.setApprovalCallback(mockApprovalCallback);

    const toolCall = {
      id: 'test-id',
      name: 'file-write',
      arguments: { path: '/test.txt', content: 'test' },
    };
    const result = await executor.executeTool(toolCall, context);

    expect(mockApprovalCallback.requestApproval).toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Tool execution denied by approval policy');
  });
});
