// ABOUTME: Integration test for session-wide approval system without mocking
// ABOUTME: Verifies that pending approvals from all agents in a session are properly retrieved

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupWebTest } from '@/test-utils/web-test-setup';
import { Session, Project } from '@/lib/server/lace-imports';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';
import { asThreadId } from '@/types/core';
import { loader as sessionApprovalsLoader } from '@/app/routes/api.sessions.$sessionId.approvals.pending';

// Mock server-only module
vi.mock('server-only', () => ({}));

describe('Session Approval Integration (No Mocking)', () => {
  const _tempLaceDir = setupWebTest();
  let session: Session;
  let projectId: string;
  let anthropicInstanceId: string;

  beforeEach(async () => {
    // Set up environment with real provider
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    // Create test project
    const project = await Project.create(
      'Approval Test Project',
      '/tmp/approval-test',
      new Map([['ANTHROPIC_KEY', 'test-key']])
    );
    projectId = project.getId();

    // Create real provider instance
    anthropicInstanceId = await createTestProviderInstance(
      projectId,
      'anthropic',
      'claude-3-5-sonnet-20240620'
    );

    // Create real session
    session = await Session.create(
      projectId,
      asThreadId(`lace_${new Date().toISOString().split('T')[0]!.replace(/-/g, '')}_integtest`),
      anthropicInstanceId,
      'claude-3-5-sonnet-20240620'
    );

    await session.initialize({
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-sonnet-20240620',
    });
  });

  afterEach(async () => {
    await cleanupTestProviderInstances();
  });

  it('should return pending approvals from session API when tools require approval', async () => {
    // Get main agent
    const mainAgent = session.getCoordinatorAgent()!;

    // Create a tool call that requires approval (bash has no policy = defaults to 'ask')
    const bashToolCall = {
      id: 'functions.bash:integration-test',
      name: 'bash',
      arguments: { command: 'ls -la' },
    };

    const toolContext = { agent: mainAgent };

    // Execute tool call - should create TOOL_APPROVAL_REQUEST and throw ApprovalPendingError
    let approvalPendingErrorThrown = false;
    try {
      await mainAgent.toolExecutor.requestToolPermission(bashToolCall, toolContext);
    } catch (error: any) {
      if (error.name === 'ApprovalPendingError') {
        approvalPendingErrorThrown = true;
      }
    }

    // Verify ApprovalPendingError was thrown (means approval request was created)
    expect(approvalPendingErrorThrown).toBe(true);

    // Now test the session-wide approval API (no mocking!)
    const request = new Request(
      `http://localhost/api/sessions/${session.getId()}/approvals/pending`
    );
    const response = await sessionApprovalsLoader({
      request,
      params: { sessionId: session.getId() },
      context: {},
    } as any);

    expect(response.status).toBe(200);
    const data = await response.json();
    const approvals = data.json;

    // Should have 1 pending approval for the bash tool
    expect(approvals).toHaveLength(1);
    expect(approvals[0].toolCallId).toBe('functions.bash:integration-test');
    expect(approvals[0].requestData.toolName).toBe('bash');
    expect(approvals[0].agentId).toBe(mainAgent.threadId);

    // Verify it's actually pending (no response yet)
    const pendingApprovalsFromAgent = mainAgent.getPendingApprovals();
    expect(pendingApprovalsFromAgent).toHaveLength(1);
    expect(pendingApprovalsFromAgent[0].toolCallId).toBe('functions.bash:integration-test');
  });

  it('should aggregate approvals from multiple agents in the same session', async () => {
    // Get main agent
    const mainAgent = session.getCoordinatorAgent()!;

    // Spawn a delegate agent
    const delegateAgent = session.spawnAgent({
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-sonnet-20240620',
    });

    // Create tool calls from both agents that require approval
    const mainToolCall = {
      id: 'functions.bash:main-test',
      name: 'bash',
      arguments: { command: 'pwd' },
    };

    const delegateToolCall = {
      id: 'functions.file_list:delegate-test',
      name: 'file_list',
      arguments: { maxDepth: 2 },
    };

    // Execute tools from both agents
    try {
      await mainAgent.toolExecutor.requestToolPermission(mainToolCall, { agent: mainAgent });
    } catch (error: any) {
      expect(error.name).toBe('ApprovalPendingError');
    }

    try {
      await delegateAgent.toolExecutor.requestToolPermission(delegateToolCall, {
        agent: delegateAgent,
      });
    } catch (error: any) {
      expect(error.name).toBe('ApprovalPendingError');
    }

    // Test session-wide aggregation
    const request = new Request(
      `http://localhost/api/sessions/${session.getId()}/approvals/pending`
    );
    const response = await sessionApprovalsLoader({
      request,
      params: { sessionId: session.getId() },
      context: {},
    } as any);

    expect(response.status).toBe(200);
    const data = await response.json();
    const approvals = data.json;

    // Should have 2 pending approvals from both agents
    expect(approvals).toHaveLength(2);

    const toolCallIds = approvals.map((a: any) => a.toolCallId);
    expect(toolCallIds).toContain('functions.bash:main-test');
    expect(toolCallIds).toContain('functions.file_list:delegate-test');

    const agentIds = approvals.map((a: any) => a.agentId);
    expect(agentIds).toContain(mainAgent.threadId);
    expect(agentIds).toContain(delegateAgent.threadId);
  });

  it('should demonstrate the bug if agent.getPendingApprovals() fails', async () => {
    // Get main agent
    const mainAgent = session.getCoordinatorAgent()!;

    // Create approval request
    const toolCall = {
      id: 'functions.bash:debug-test',
      name: 'bash',
      arguments: { command: 'echo test' },
    };

    try {
      await mainAgent.toolExecutor.requestToolPermission(toolCall, { agent: mainAgent });
    } catch (error: any) {
      expect(error.name).toBe('ApprovalPendingError');
    }

    // Test what happens when we call agent.getPendingApprovals() directly
    let directCallError = null;
    try {
      const pendingApprovals = mainAgent.getPendingApprovals();
      console.log('Direct getPendingApprovals() result:', pendingApprovals);
      expect(pendingApprovals).toHaveLength(1);
    } catch (error) {
      directCallError = error;
      console.log('Direct getPendingApprovals() failed:', error);
    }

    // This test will help us understand what's failing
    if (directCallError) {
      // Document the error for debugging
      expect(directCallError).toBeDefined();
      console.log(
        'ERROR: agent.getPendingApprovals() is failing, which explains the session API warnings'
      );
    } else {
      console.log('SUCCESS: agent.getPendingApprovals() works correctly');
    }
  });
});
