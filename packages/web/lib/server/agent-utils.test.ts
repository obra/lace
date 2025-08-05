// ABOUTME: Tests for event-based approval callback with real Agent and Session instances
// ABOUTME: Validates that approval requests create events and session-wide approvals work correctly

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupAgentApprovals } from '@/lib/server/agent-utils';
import { Agent, ToolExecutor, Session, Project, ThreadManager } from '@/lib/server/lace-imports';
import { asThreadId, type ThreadId } from '@/types/core';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { setupTestProviderDefaults, cleanupTestProviderDefaults } from '~/test-utils/provider-defaults';
import { createTestProviderInstance, cleanupTestProviderInstances } from '~/test-utils/provider-instances';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import { ApprovalPendingError, ApprovalDecision } from '~/tools/approval-types';
import { TestProvider } from '~/test-utils/test-provider';

describe('Event-Based Approval Callback', () => {
  const _tempLaceDir = useTempLaceDir();
  let agent: Agent;
  let session: Session;
  let threadId: ThreadId;
  let threadManager: ThreadManager;
  let providerInstanceId: string;

  beforeEach(async () => {
    // Set up test provider defaults and create instance
    setupTestProviderDefaults();
    Session.clearProviderCache();
    
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      apiKey: 'test-anthropic-key',
    });

    // Set up test persistence
    setupTestPersistence();

    // Create real instances
    threadManager = new ThreadManager();

    const toolExecutor = new ToolExecutor();
    toolExecutor.registerAllAvailableTools();

    const provider = new TestProvider();

    // Create project and session with provider configuration
    const project = Project.create(
      'Test Project',
      process.cwd(),
      'Test project',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );
    session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
    });
    threadId = asThreadId(session.getId());

    threadManager.createThread(threadId);

    agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: toolExecutor.getAllTools(),
    });

    // Set up approvals
    setupAgentApprovals(agent, threadId);
  });

  afterEach(async () => {
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
    teardownTestPersistence();
  });

  it('should create TOOL_APPROVAL_REQUEST event when approval is requested', async () => {
    const approvalCallback = agent.toolExecutor.getApprovalCallback();
    expect(approvalCallback).toBeDefined();

    // Request approval for a tool that requires approval
    const toolCall = { id: 'call_123', name: 'bash', arguments: { command: 'ls' } };

    try {
      await approvalCallback!.requestApproval(toolCall);
      throw new Error('Expected ApprovalPendingError to be thrown');
    } catch (error: unknown) {
      // Verify that ApprovalPendingError was thrown with correct toolCallId
      expect(error).toBeInstanceOf(ApprovalPendingError);
      const approvalError = error as ApprovalPendingError;
      expect(approvalError.toolCallId).toBe('call_123');
    }

    // Verify TOOL_APPROVAL_REQUEST event was created
    const events = threadManager.getEvents(threadId);
    const approvalRequestEvent = events.find((e) => e.type === 'TOOL_APPROVAL_REQUEST');
    expect(approvalRequestEvent).toBeDefined();
    expect(approvalRequestEvent?.data).toEqual({ toolCallId: 'call_123' });
  });

  it('should return ALLOW_SESSION for tools with session-wide approval', async () => {
    // Set up session-wide approval for bash tool
    session.updateConfiguration({
      toolPolicies: { bash: 'allow' },
    });

    const approvalCallback = agent.toolExecutor.getApprovalCallback();
    expect(approvalCallback).toBeDefined();

    const toolCall = { id: 'call_456', name: 'bash', arguments: { command: 'pwd' } };

    const decision = await approvalCallback!.requestApproval(toolCall);
    expect(decision).toBe(ApprovalDecision.ALLOW_SESSION);

    // Should not create approval request event since tool is pre-approved
    const events = threadManager.getEvents(threadId);
    const approvalRequestEvent = events.find(
      (e) => e.type === 'TOOL_APPROVAL_REQUEST' && e.data.toolCallId === 'call_456'
    );
    expect(approvalRequestEvent).toBeUndefined();
  });

  it('should return existing approval if response already exists', async () => {
    const approvalCallback = agent.toolExecutor.getApprovalCallback();
    expect(approvalCallback).toBeDefined();

    const toolCall = { id: 'call_789', name: 'read', arguments: { file_path: '/test.txt' } };

    // First, create an approval request
    try {
      await approvalCallback!.requestApproval(toolCall);
    } catch (error) {
      expect(error).toBeInstanceOf(ApprovalPendingError);
    }

    // Now simulate an approval response
    threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'call_789',
      decision: ApprovalDecision.ALLOW_ONCE,
    });

    // Second request should return the existing approval
    const decision = await approvalCallback!.requestApproval(toolCall);
    expect(decision).toBe(ApprovalDecision.ALLOW_ONCE);
  });
});
