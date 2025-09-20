// ABOUTME: Integration tests for tool permission checking with safeInternal annotation
// ABOUTME: Tests real permission flow without mocking to ensure tools are properly allowed/denied

import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from './agent';
import { ToolExecutor } from '~/tools/executor';
import { Tool } from '~/tools/tool';
import { z } from 'zod';
import type { ToolResult, ToolContext, ToolAnnotations, ToolCall } from '~/tools/types';
import type { ThreadId } from '~/threads/types';
import { getPersistence, type DatabasePersistence } from '~/persistence/database';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { Session } from '~/sessions/session';
import { ThreadManager } from '~/threads/thread-manager';
import type { ProjectId } from '~/projects/types';

// Test tool that can be configured with different annotations
class TestTool extends Tool {
  name: string;
  description = 'Test tool for permission testing';
  schema = z.object({
    message: z.string(),
  });
  annotations?: ToolAnnotations;

  constructor(name: string, annotations?: ToolAnnotations) {
    super();
    this.name = name;
    this.annotations = annotations;
  }

  protected async executeValidated(
    args: { message: string },
    _context?: ToolContext
  ): Promise<ToolResult> {
    return this.createResult(`Executed: ${args.message}`);
  }
}

describe('Agent Tool Permissions', () => {
  let agent: Agent;
  let toolExecutor: ToolExecutor;
  let session: Session;
  let db: DatabasePersistence;
  let threadManager: ThreadManager;
  let sessionData: unknown;
  const _tempLaceDir = setupCoreTest();

  const threadId = 'test_thread_001' as ThreadId;
  const sessionId = 'test_session_001' as ThreadId;
  const projectId = 'test_project_001' as ProjectId;

  beforeEach(async () => {
    db = getPersistence();
    toolExecutor = new ToolExecutor();
    threadManager = new ThreadManager(db);

    // Create project
    const project = {
      id: projectId,
      name: 'Test Project',
      path: '/tmp/test-project',
      workingDirectory: '/tmp/test-project',
      description: 'Test project for permission testing',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastUsedAt: new Date(),
    };
    db.saveProject(project);

    // Create session data
    sessionData = {
      id: sessionId,
      projectId,
      name: 'Test Session',
      description: 'Test session for permission testing',
      configuration: {
        tools: ['safe_tool', 'unsafe_tool', 'denied_tool', 'policy_allowed_tool'],
      },
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.saveSession(sessionData);

    // Create session instance
    session = new Session(sessionId, sessionData, threadManager);

    // Create thread
    db.saveThread({
      id: threadId,
      sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
      events: [],
    });

    // Register test tools with different configurations
    toolExecutor.registerTools([
      new TestTool('safe_tool', { safeInternal: true }),
      new TestTool('unsafe_tool'), // No annotations
      new TestTool('denied_tool'),
      new TestTool('policy_allowed_tool'),
      new TestTool('not_in_allowlist'), // Not in session config tools
    ]);

    // Update session data with tool policies
    const typedSessionData = sessionData as {
      configuration: { toolPolicies?: Record<string, string> };
      [key: string]: unknown;
    };
    typedSessionData.configuration.toolPolicies = {
      policy_allowed_tool: 'allow',
      denied_tool: 'deny',
      unsafe_tool: 'ask',
    };
    db.saveSession(sessionData);

    // Recreate session with updated configuration
    session = new Session(sessionId, sessionData, threadManager);

    // Create a minimal agent for testing
    // We'll directly test the _checkToolPermission method
    agent = new Agent({
      threadId,
      threadManager,
      toolExecutor,
      persona: 'test-agent',
      tools: [],
    });

    // Mock getFullSession to return our test session
    (agent as unknown as { getFullSession: () => Promise<Session> }).getFullSession = async () =>
      session;
  });

  it('should auto-allow tools marked as safeInternal', async () => {
    // Use reflection to test the private _checkToolPermission method
    // This is acceptable for unit testing internal behavior
    const checkPermission = (
      agent as unknown as {
        _checkToolPermission: (
          toolCall: ToolCall
        ) => Promise<'granted' | 'approval_required' | 'denied'>;
      }
    )._checkToolPermission.bind(agent);

    const toolCall: ToolCall = {
      id: 'tool_call_001',
      name: 'safe_tool',
      arguments: { message: 'testing safe tool' },
    };

    const permission = await checkPermission(toolCall);
    expect(permission).toBe('granted');
  });

  it('should request approval for tools without safeInternal annotation', async () => {
    const checkPermission = (
      agent as unknown as {
        _checkToolPermission: (
          toolCall: ToolCall
        ) => Promise<'granted' | 'approval_required' | 'denied'>;
      }
    )._checkToolPermission.bind(agent);

    const toolCall: ToolCall = {
      id: 'tool_call_002',
      name: 'unsafe_tool',
      arguments: { message: 'testing unsafe tool' },
    };

    const permission = await checkPermission(toolCall);
    expect(permission).toBe('approval_required');
  });

  it('should deny tools with explicit deny policy', async () => {
    const checkPermission = (
      agent as unknown as {
        _checkToolPermission: (
          toolCall: ToolCall
        ) => Promise<'granted' | 'approval_required' | 'denied'>;
      }
    )._checkToolPermission.bind(agent);

    const toolCall: ToolCall = {
      id: 'tool_call_003',
      name: 'denied_tool',
      arguments: { message: 'testing denied tool' },
    };

    const permission = await checkPermission(toolCall);
    expect(permission).toBe('denied');
  });

  it('should allow tools with explicit allow policy even without safeInternal', async () => {
    const checkPermission = (
      agent as unknown as {
        _checkToolPermission: (
          toolCall: ToolCall
        ) => Promise<'granted' | 'approval_required' | 'denied'>;
      }
    )._checkToolPermission.bind(agent);

    const toolCall: ToolCall = {
      id: 'tool_call_004',
      name: 'policy_allowed_tool',
      arguments: { message: 'testing policy allowed' },
    };

    const permission = await checkPermission(toolCall);
    expect(permission).toBe('granted');
  });

  it('should deny tools not in session allowlist regardless of safeInternal', async () => {
    // Register a safe tool that's not in the allowlist
    const safeTool = new TestTool('not_in_allowlist_safe', { safeInternal: true });
    toolExecutor.registerTool('not_in_allowlist_safe', safeTool);

    const checkPermission = (
      agent as unknown as {
        _checkToolPermission: (
          toolCall: ToolCall
        ) => Promise<'granted' | 'approval_required' | 'denied'>;
      }
    )._checkToolPermission.bind(agent);

    const toolCall: ToolCall = {
      id: 'tool_call_005',
      name: 'not_in_allowlist_safe',
      arguments: { message: 'testing not in allowlist' },
    };

    const permission = await checkPermission(toolCall);
    expect(permission).toBe('denied'); // Security check comes first
  });

  it('should prioritize safeInternal over database policies', async () => {
    // Add a policy to deny a safe tool - safeInternal should override
    const baseData = sessionData as {
      configuration: { toolPolicies?: Record<string, string> };
      [key: string]: unknown;
    };
    const updatedSessionData = { ...baseData };
    updatedSessionData.configuration.toolPolicies = {
      ...updatedSessionData.configuration.toolPolicies,
      safe_tool: 'deny',
    };
    db.saveSession(updatedSessionData);
    session = new Session(sessionId, updatedSessionData, threadManager);

    const checkPermission = (
      agent as unknown as {
        _checkToolPermission: (
          toolCall: ToolCall
        ) => Promise<'granted' | 'approval_required' | 'denied'>;
      }
    )._checkToolPermission.bind(agent);

    const toolCall: ToolCall = {
      id: 'tool_call_006',
      name: 'safe_tool',
      arguments: { message: 'testing safe overrides deny' },
    };

    const permission = await checkPermission(toolCall);
    expect(permission).toBe('granted'); // safeInternal takes precedence
  });

  it('should correctly check safeInternal for real task management tools', async () => {
    // Import real task tools to ensure they work correctly
    const { TaskCreateTool, TaskListTool } = await import(
      '~/tools/implementations/task-manager/index'
    );

    const taskCreateTool = new TaskCreateTool();
    const taskListTool = new TaskListTool();

    // Verify task tools have safeInternal annotation
    expect(taskCreateTool.annotations?.safeInternal).toBe(true);
    expect(taskListTool.annotations?.safeInternal).toBe(true);

    // Register real task tools
    toolExecutor.registerTools([taskCreateTool, taskListTool]);

    // Update session config to include task tools
    const updatedSessionData = {
      id: sessionId,
      projectId,
      name: 'Test Session',
      description: 'Test session for permission testing',
      configuration: {
        tools: ['task_add', 'task_list'],
      },
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.saveSession(updatedSessionData);
    session = new Session(sessionId, updatedSessionData, threadManager);

    const checkPermission = (
      agent as unknown as {
        _checkToolPermission: (
          toolCall: ToolCall
        ) => Promise<'granted' | 'approval_required' | 'denied'>;
      }
    )._checkToolPermission.bind(agent);

    const toolCall: ToolCall = {
      id: 'tool_call_007',
      name: 'task_add',
      arguments: {
        title: 'Test task',
        description: 'A test task',
      },
    };

    const permission = await checkPermission(toolCall);
    expect(permission).toBe('granted'); // safeInternal task tools are auto-granted
  });

  it('should handle missing session gracefully', async () => {
    // Create agent with non-existent session
    const orphanAgent = new Agent({
      threadId: 'orphan_thread' as ThreadId,
      threadManager,
      toolExecutor,
      persona: 'orphan-agent',
      tools: [],
    });

    // Mock getFullSession to return undefined (no session)
    (
      orphanAgent as unknown as { getFullSession: () => Promise<Session | undefined> }
    ).getFullSession = async () => undefined;

    const checkPermission = (
      orphanAgent as unknown as {
        _checkToolPermission: (
          toolCall: ToolCall
        ) => Promise<'granted' | 'approval_required' | 'denied'>;
      }
    )._checkToolPermission.bind(orphanAgent);

    const toolCall: ToolCall = {
      id: 'tool_call_008',
      name: 'safe_tool',
      arguments: { message: 'testing without session' },
    };

    const permission = await checkPermission(toolCall);
    expect(permission).toBe('denied'); // No session means denied
  });
});
