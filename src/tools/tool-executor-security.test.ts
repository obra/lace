// ABOUTME: Test ToolExecutor security policy enforcement with real Session context
// ABOUTME: Validates that tools require session context and respect security policies

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolExecutor } from '~/tools/executor';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { EventApprovalCallback } from '~/tools/event-approval-callback';
import { Agent } from '~/agents/agent';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import { ToolCall, ToolContext } from '~/tools/types';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';

describe('ToolExecutor Security with Real Session Context', () => {
  const tempDirContext = useTempLaceDir();
  let toolExecutor: ToolExecutor;
  let session: Session;
  let agent: Agent;
  let project: Project;
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestPersistence();
    setupTestProviderDefaults();

    // Create real provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create real project
    project = Project.create(
      'Security Test Project',
      'Project for security testing',
      tempDirContext.tempDir,
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );

    // Create real session
    session = Session.create({
      name: 'Security Test Session',
      projectId: project.getId(),
      configuration: {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      },
    });

    // Get coordinator agent and set up tool executor
    const coordinatorAgent = session.getAgent(session.getId());
    if (!coordinatorAgent) {
      throw new Error('Failed to get coordinator agent');
    }
    agent = coordinatorAgent;
    toolExecutor = agent.toolExecutor;

    // Tools should be registered via session creation process
    // If no tools, register them manually for testing
    const availableTools = toolExecutor.getAvailableToolNames();
    if (availableTools.length === 0) {
      toolExecutor.registerAllAvailableTools();
    }

    // Set up approval callback
    const approvalCallback = new EventApprovalCallback(agent);
    toolExecutor.setApprovalCallback(approvalCallback);
  });

  afterEach(async () => {
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }
    teardownTestPersistence();
    cleanupTestProviderDefaults();
  });

  describe('Security Policy Enforcement', () => {
    it('should DENY tool execution when no session context provided', async () => {
      const toolCall: ToolCall = {
        id: 'test-call-123',
        name: 'file_read',
        arguments: { path: '/test/file.txt' },
      };

      // Test with no session context (undefined)
      await expect(toolExecutor.requestToolPermission(toolCall, undefined)).rejects.toThrow(
        'Tool execution denied: session context required for security policy enforcement'
      );

      // Test with empty context (no session property)
      const emptyContext = {
        threadId: agent.threadId,
        workingDirectory: '/tmp',
      } as ToolContext;

      await expect(toolExecutor.requestToolPermission(toolCall, emptyContext)).rejects.toThrow(
        'Tool execution denied: session context required for security policy enforcement'
      );
    });

    it('should require approval by default when session context is provided', async () => {
      const toolCall: ToolCall = {
        id: 'test-call-456',
        name: 'file_write',
        arguments: { file_path: '/test/write.txt', content: 'test' },
      };

      const toolContext: ToolContext = {
        threadId: agent.threadId,
        workingDirectory: tempDirContext.tempDir,
        session,
      };

      // Should return 'pending' because default policy is 'require-approval'
      const permission = await toolExecutor.requestToolPermission(toolCall, toolContext);
      expect(permission).toBe('pending');
    });

    it('should check session tool policy correctly', async () => {
      // Verify that session.getToolPolicy() returns 'require-approval' by default
      const policy = session.getToolPolicy('file_read');
      expect(policy).toBe('require-approval');

      const toolCall: ToolCall = {
        id: 'test-call-789',
        name: 'file_read',
        arguments: { path: '/test/file.txt' },
      };

      const toolContext: ToolContext = {
        threadId: agent.threadId,
        workingDirectory: tempDirContext.tempDir,
        session,
      };

      // Should return 'pending' since default policy is 'require-approval'
      const permission = await toolExecutor.requestToolPermission(toolCall, toolContext);
      expect(permission).toBe('pending');
    });

    it('should respect explicit tool policies', async () => {
      // Create session with explicit allow policy for file-read
      const permissiveSession = Session.create({
        name: 'Permissive Session',
        projectId: project.getId(),
        configuration: {
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
          toolPolicies: {
            file_read: 'allow' as const,
          },
        },
      });

      const toolCall: ToolCall = {
        id: 'test-call-allow',
        name: 'file_read',
        arguments: { path: '/test/file.txt' },
      };

      const toolContext: ToolContext = {
        threadId: agent.threadId,
        workingDirectory: tempDirContext.tempDir,
        session: permissiveSession,
      };

      // Should be granted immediately without approval
      const permission = await toolExecutor.requestToolPermission(toolCall, toolContext);
      expect(permission).toBe('granted');
    });

    it('should deny tools with explicit deny policy', async () => {
      // Create session with explicit deny policy for bash
      const restrictiveSession = Session.create({
        name: 'Restrictive Session',
        projectId: project.getId(),
        configuration: {
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
          toolPolicies: {
            bash: 'deny' as const,
          },
        },
      });

      const toolCall: ToolCall = {
        id: 'test-call-deny',
        name: 'bash',
        arguments: { command: 'echo test' },
      };

      const toolContext: ToolContext = {
        threadId: agent.threadId,
        workingDirectory: tempDirContext.tempDir,
        session: restrictiveSession,
      };

      // Should be denied outright
      await expect(toolExecutor.requestToolPermission(toolCall, toolContext)).rejects.toThrow(
        "Tool 'bash' execution denied by policy"
      );
    });
  });

  describe('Fail-Safe Behavior', () => {
    it('should fail when approval callback is missing but required', async () => {
      // Create tool executor without approval callback
      const unsafeExecutor = new ToolExecutor();
      unsafeExecutor.registerAllAvailableTools();
      // Note: No approval callback set

      const toolCall: ToolCall = {
        id: 'test-call-unsafe',
        name: 'file_read',
        arguments: { path: '/test/file.txt' },
      };

      const toolContext: ToolContext = {
        threadId: agent.threadId,
        workingDirectory: tempDirContext.tempDir,
        session,
      };

      // Should fail because no approval callback is configured
      await expect(unsafeExecutor.requestToolPermission(toolCall, toolContext)).rejects.toThrow(
        'Tool execution requires approval but no approval callback is configured'
      );
    });
  });
});
