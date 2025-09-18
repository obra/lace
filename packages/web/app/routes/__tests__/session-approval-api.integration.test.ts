// ABOUTME: Real integration tests for session-wide approval aggregation API
// ABOUTME: Tests actual approval flow with real components - no mocking of business logic

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupWebTest } from '@/test-utils/web-test-setup';
import { Session, Project, TestProvider } from '@/lib/server/lace-imports';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';
import { asThreadId } from '@/types/core';
import { parseResponse } from '@/lib/serialization';
import { createLoaderArgs, createActionArgs } from '@/test-utils/route-test-helpers';
import { loader as pendingApprovalsLoader } from '../api.sessions.$sessionId.approvals.pending';
import { action as approvalDecisionAction } from '../api.sessions.$sessionId.approvals.$toolCallId';
import type { ProviderResponse } from '@lace/core/providers/base-provider';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Mock provider that returns tool calls requiring approval
class MockProviderWithToolCalls extends TestProvider {
  private responses: ProviderResponse[] = [];
  private responseIndex = 0;

  setResponses(responses: ProviderResponse[]) {
    this.responses = responses;
    this.responseIndex = 0;
  }

  async createResponse(): Promise<ProviderResponse> {
    if (this.responseIndex < this.responses.length) {
      return this.responses[this.responseIndex++]!;
    }
    // Default response to prevent infinite loops
    return {
      content: 'Task completed.',
      toolCalls: [],
      stopReason: 'stop',
    };
  }
}

describe('Session Approval API Integration (Real Components)', () => {
  const _tempLaceDir = setupWebTest();
  let session: Session;
  let project: Project;
  let mockProvider: MockProviderWithToolCalls;

  beforeEach(async () => {
    // Set up test provider defaults (following agent-utils.test.ts pattern)
    const { setupTestProviderDefaults } = await import('@/lib/server/lace-imports');
    setupTestProviderDefaults();

    // Create test provider instance
    const providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      apiKey: 'test-anthropic-key',
    });

    // Create project with provider configuration
    project = Project.create(
      'Session Approval Test Project',
      _tempLaceDir.tempDir,
      'Test project',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );

    // Create mock provider that returns tool calls
    mockProvider = new MockProviderWithToolCalls();

    // Mock ProviderRegistry to return our mock provider
    const { ProviderRegistry } = await import('@/lib/server/lace-imports');
    vi.spyOn(ProviderRegistry.prototype, 'createProvider').mockReturnValue(mockProvider);
    vi.spyOn(ProviderRegistry.prototype, 'getProvider').mockReturnValue(mockProvider);

    // Create real session
    session = Session.create({
      name: 'Session Approval Test Session',
      projectId: project.getId(),
    });
  });

  afterEach(async () => {
    const { cleanupTestProviderDefaults } = await import('@/lib/server/lace-imports');
    cleanupTestProviderDefaults();

    // Provider instances cleanup is handled by setupWebTest
    vi.clearAllMocks();
    session?.destroy();
  });

  it('should aggregate pending approvals from multiple real agents', async () => {
    // Get main agent
    const mainAgent = session.getCoordinatorAgent()!;

    // Set up mock provider to return tool calls requiring approval
    mockProvider.setResponses([
      {
        content: 'I will run the main bash command.',
        toolCalls: [
          {
            id: 'main-bash-call',
            name: 'bash',
            arguments: { command: 'echo main-agent' },
          },
        ],
        stopReason: 'tool_use',
      },
    ]);

    // Mock main agent provider to use our mock
    vi.spyOn(mainAgent as any, '_createProviderInstance').mockResolvedValue(mockProvider);

    // Trigger main agent conversation - creates approval request
    await mainAgent.sendMessage('Run main command');

    // Wait for main agent approval request
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Now spawn delegate agent and trigger its approval request
    const delegateAgent = session.spawnAgent({});

    // Set up separate mock responses for delegate agent
    const delegateMockProvider = new MockProviderWithToolCalls();
    delegateMockProvider.setResponses([
      {
        content: 'I will run the delegate bash command.',
        toolCalls: [
          {
            id: 'delegate-bash-call',
            name: 'bash',
            arguments: { command: 'echo delegate-agent' },
          },
        ],
        stopReason: 'tool_use',
      },
    ]);

    // Mock delegate agent provider
    vi.spyOn(delegateAgent as any, '_createProviderInstance').mockResolvedValue(
      delegateMockProvider
    );

    // Trigger delegate agent conversation - creates second approval request
    await delegateAgent.sendMessage('Run delegate command');

    // Wait for delegate agent approval request
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify both agents created approval requests
    const mainEvents = mainAgent.threadManager.getEvents(mainAgent.threadId);
    const mainApprovalRequest = mainEvents.find((e) => e.type === 'TOOL_APPROVAL_REQUEST');
    expect(mainApprovalRequest).toBeDefined();

    const delegateEvents = delegateAgent.threadManager.getEvents(delegateAgent.threadId);
    const delegateApprovalRequest = delegateEvents.find((e) => e.type === 'TOOL_APPROVAL_REQUEST');
    expect(delegateApprovalRequest).toBeDefined();

    // Test session API with real session using proper route testing pattern
    const request = new Request(
      `http://localhost/api/sessions/${session.getId()}/approvals/pending`
    );
    const response = await pendingApprovalsLoader(
      createLoaderArgs(request, { sessionId: session.getId() })
    );
    const approvals = await parseResponse(response);

    // Should aggregate approvals from both agents
    expect(approvals).toHaveLength(2);

    const toolCallIds = approvals.map((a: any) => a.toolCallId);
    expect(toolCallIds).toContain('main-bash-call');
    expect(toolCallIds).toContain('delegate-bash-call');

    const agentIds = approvals.map((a: any) => a.agentId);
    expect(agentIds).toContain(mainAgent.threadId);
    expect(agentIds).toContain(delegateAgent.threadId);

    // Verify approval metadata
    const mainApproval = approvals.find((a: any) => a.toolCallId === 'main-bash-call');
    expect(mainApproval.requestData.toolName).toBe('bash');
    expect(mainApproval.agentId).toBe(mainAgent.threadId);

    const delegateApproval = approvals.find((a: any) => a.toolCallId === 'delegate-bash-call');
    expect(delegateApproval.requestData.toolName).toBe('bash');
    expect(delegateApproval.agentId).toBe(delegateAgent.threadId);
  });

  it('should route approval decisions to correct agent', async () => {
    // Get delegate agent (inherits provider config from session)
    const delegateAgent = session.spawnAgent({});

    // Set up mock provider for delegate agent
    const delegateMockProvider = new MockProviderWithToolCalls();
    delegateMockProvider.setResponses([
      {
        content: 'I will run the routing test.',
        toolCalls: [
          {
            id: 'routing-test-call',
            name: 'bash',
            arguments: { command: 'echo routing-test' },
          },
        ],
        stopReason: 'tool_use',
      },
    ]);

    // Mock delegate agent provider
    vi.spyOn(delegateAgent as any, '_createProviderInstance').mockResolvedValue(
      delegateMockProvider
    );

    // Trigger delegate conversation - creates real approval request
    await delegateAgent.sendMessage('Run routing test');

    // Wait for approval request
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify approval request exists in delegate thread
    const delegateEvents = delegateAgent.threadManager.getEvents(delegateAgent.threadId);
    const approvalRequest = delegateEvents.find((e) => e.type === 'TOOL_APPROVAL_REQUEST');
    expect(approvalRequest).toBeDefined();

    // Verify delegate agent has pending approval
    const pendingApprovals = delegateAgent.getPendingApprovals();
    expect(pendingApprovals).toHaveLength(1);
    expect(pendingApprovals[0].toolCallId).toBe('routing-test-call');

    // Submit approval decision via session API using proper route testing pattern
    const request = new Request(
      `http://localhost/api/sessions/${session.getId()}/approvals/routing-test-call`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'allow_once' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const response = await approvalDecisionAction(
      createActionArgs(request, {
        sessionId: session.getId(),
        toolCallId: 'routing-test-call',
      })
    );
    const result = await parseResponse(response);

    // Verify success
    expect(result.success).toBe(true);

    // Verify approval was processed by checking pending approvals are cleared
    await new Promise((resolve) => setTimeout(resolve, 100)); // Allow processing time
    const remainingApprovals = delegateAgent.getPendingApprovals();
    expect(remainingApprovals).toHaveLength(0);
  });

  it('should handle session with no agents gracefully', async () => {
    // Create session but don't initialize any agents
    const emptySession = Session.create({
      name: 'Empty Session',
      projectId: project.getId(),
    });

    const request = new Request(
      `http://localhost/api/sessions/${emptySession.getId()}/approvals/pending`
    );
    const response = await pendingApprovalsLoader({
      request,
      params: { sessionId: emptySession.getId() },
      context: {},
    } as any);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.json).toEqual([]);
  });

  it('should return 404 for non-existent session', async () => {
    const nonExistentSessionId = 'lace_20250916_notfound';

    const request = new Request(
      `http://localhost/api/sessions/${nonExistentSessionId}/approvals/pending`
    );
    const response = await pendingApprovalsLoader({
      request,
      params: { sessionId: nonExistentSessionId },
      context: {},
    } as any);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('should return 404 when tool call not found in any agent', async () => {
    // Create session with agents but no pending approvals
    const mainAgent = session.getCoordinatorAgent()!;

    // Verify no pending approvals exist
    const pendingApprovals = mainAgent.getPendingApprovals();
    expect(pendingApprovals).toHaveLength(0);

    const request = new Request(
      `http://localhost/api/sessions/${session.getId()}/approvals/non-existent-tool-call`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'allow_once' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const response = await approvalDecisionAction({
      request,
      params: {
        sessionId: session.getId(),
        toolCallId: 'non-existent-tool-call',
      },
      context: {},
    } as any);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error.code).toBe('RESOURCE_NOT_FOUND');
  });
});
