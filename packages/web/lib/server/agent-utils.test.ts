// ABOUTME: Tests for callback-free agent approval flow with real Agent and Session instances
// ABOUTME: Validates that agent-owned approval system creates events correctly

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent, ToolExecutor, Session, Project, ThreadManager } from '@/lib/server/lace-imports';
import { asThreadId, type ThreadId } from '@/types/core';
import { setupWebTest } from '@/test-utils/web-test-setup';
import { setupTestProviderDefaults, cleanupTestProviderDefaults } from '@/lib/server/lace-imports';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';
import { ApprovalPendingError, ApprovalDecision } from '@/lib/server/lace-imports';
import { TestProvider } from '@/lib/server/lace-imports';

describe('Callback-Free Agent Approval Flow', () => {
  const _tempLaceDir = setupWebTest();
  let agent: Agent;
  let session: Session;
  let threadId: ThreadId;
  let threadManager: ThreadManager;
  let providerInstanceId: string;

  beforeEach(async () => {
    // Set up test provider defaults and create instance
    setupTestProviderDefaults();

    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      apiKey: 'test-anthropic-key',
    });

    // Test persistence is set up automatically by setupWebTest()

    // Create real instances
    threadManager = new ThreadManager();

    const toolExecutor = new ToolExecutor();
    toolExecutor.registerAllAvailableTools();

    const provider = new TestProvider();

    // Create project and session with provider configuration
    const project = Project.create('Test Project', process.cwd(), 'Test project', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
    session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
    });
    threadId = asThreadId(session.getId());

    threadManager.createThread(threadId, session.getId());

    agent = new Agent({
      toolExecutor,
      threadManager,
      threadId,
      tools: toolExecutor.getAllTools(),
      metadata: {
        name: 'test-agent',
        modelId: 'claude-3-5-haiku-20241022',
        providerInstanceId,
      },
    });

    // Mock provider creation for test - type-safe approach
    const createProviderSpy = vi.fn().mockResolvedValue(provider);
    Object.defineProperty(agent, '_createProviderInstance', {
      value: createProviderSpy,
      writable: true,
      configurable: true,
    });

    // No callback setup needed - Agent owns approval flow in callback-free architecture
  });

  afterEach(async () => {
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
    vi.clearAllMocks();
  });

  it('should create TOOL_APPROVAL_REQUEST event through agent conversation flow', async () => {
    // Set up mock provider to return tool calls requiring approval
    const provider = new TestProvider();
    vi.spyOn(provider, 'createResponse').mockResolvedValue({
      content: 'I will run the bash command.',
      toolCalls: [
        {
          id: 'call_123',
          name: 'bash',
          arguments: { command: 'ls' },
        },
      ],
      stopReason: 'tool_use',
    });

    // Mock provider creation to use our test provider
    const createProviderSpy = vi.fn().mockResolvedValue(provider);
    Object.defineProperty(agent, '_createProviderInstance', {
      value: createProviderSpy,
      writable: true,
      configurable: true,
    });

    // Trigger conversation flow - this should create approval request for bash tool
    await agent.sendMessage('Run ls command');

    // Wait for approval request to be processed
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify TOOL_APPROVAL_REQUEST event was created through agent-owned flow
    const events = threadManager.getEvents(threadId);
    const approvalRequestEvent = events.find((e) => e.type === 'TOOL_APPROVAL_REQUEST');
    expect(approvalRequestEvent).toBeDefined();
    expect(approvalRequestEvent?.data).toEqual({ toolCallId: 'call_123' });
  });

  it('should execute tools immediately when session policy allows', async () => {
    // Set up session-wide approval for bash tool
    session.updateConfiguration({
      toolPolicies: { bash: 'allow' },
    });

    // Set up mock provider to return allowed tool calls
    const provider = new TestProvider();
    vi.spyOn(provider, 'createResponse').mockResolvedValue({
      content: 'I will run the pwd command.',
      toolCalls: [
        {
          id: 'call_456',
          name: 'bash',
          arguments: { command: 'pwd' },
        },
      ],
      stopReason: 'tool_use',
    });

    // Mock provider creation
    const createProviderSpy = vi.fn().mockResolvedValue(provider);
    Object.defineProperty(agent, '_createProviderInstance', {
      value: createProviderSpy,
      writable: true,
      configurable: true,
    });

    // Trigger conversation flow with allowed tool
    await agent.sendMessage('Run pwd command');

    // Wait for tool execution to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    const events = threadManager.getEvents(threadId);

    // Should NOT create approval request event since tool is pre-approved
    const approvalRequestEvent = events.find(
      (e) => e.type === 'TOOL_APPROVAL_REQUEST' && e.data.toolCallId === 'call_456'
    );
    expect(approvalRequestEvent).toBeUndefined();

    // Should create TOOL_RESULT event since tool executed immediately
    const toolResultEvent = events.find(
      (e) => e.type === 'TOOL_RESULT' && e.data.id === 'call_456'
    );
    expect(toolResultEvent).toBeDefined();
  });

  it('should handle approval response and execute tool', async () => {
    // Set up provider to return tool calls requiring approval
    const provider = new TestProvider();
    vi.spyOn(provider, 'createResponse').mockResolvedValue({
      content: 'I will read the file.',
      toolCalls: [
        {
          id: 'call_789',
          name: 'file_read',
          arguments: { path: '/test.txt' },
        },
      ],
      stopReason: 'tool_use',
    });

    // Mock provider creation
    const createProviderSpy = vi.fn().mockResolvedValue(provider);
    Object.defineProperty(agent, '_createProviderInstance', {
      value: createProviderSpy,
      writable: true,
      configurable: true,
    });

    // Trigger conversation flow - creates approval request
    await agent.sendMessage('Read the test file');

    // Wait for approval request
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify approval request was created
    const events = threadManager.getEvents(threadId);
    const approvalRequestEvent = events.find((e) => e.type === 'TOOL_APPROVAL_REQUEST');
    expect(approvalRequestEvent).toBeDefined();
    expect(approvalRequestEvent?.data.toolCallId).toBe('call_789');

    // Simulate approval response through agent method
    await agent.handleApprovalResponse('call_789', ApprovalDecision.ALLOW_ONCE);

    // Wait for tool execution
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify approval response and tool result events were created
    const finalEvents = threadManager.getEvents(threadId);
    const approvalResponseEvent = finalEvents.find((e) => e.type === 'TOOL_APPROVAL_RESPONSE');
    expect(approvalResponseEvent).toBeDefined();
    expect(approvalResponseEvent?.data.decision).toBe(ApprovalDecision.ALLOW_ONCE);

    const toolResultEvent = finalEvents.find((e) => e.type === 'TOOL_RESULT');
    expect(toolResultEvent).toBeDefined();
    expect(toolResultEvent?.data.id).toBe('call_789');
  });
});
