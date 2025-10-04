// ABOUTME: Tests for auto-resolution of pending approvals on permission mode changes
// ABOUTME: Verifies that switching to yolo/read-only modes auto-resolves pending tool approvals

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Session } from './session';
import { Agent } from '@lace/core/agents/agent';
import { ToolExecutor } from '@lace/core/tools/executor';
import { ApprovalDecision } from '@lace/core/tools/types';
import { ThreadManager } from '@lace/core/threads/thread-manager';
import { setupCoreTest } from '@lace/core/test-utils/core-test-setup';
import { Project } from '@lace/core/projects/project';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '@lace/core/test-utils/provider-defaults';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@lace/core/test-utils/provider-instances';
import { join } from 'path';
import { mkdirSync } from 'fs';

// Mock the logger to reduce noise
vi.mock('@lace/core/utils/logger');

describe('Session Permission Auto-Resolution', () => {
  const tempLaceDir = setupCoreTest();
  let tempProjectDir: string;
  let session: Session;
  let agent: Agent;
  let project: Project;
  let providerInstanceId: string;

  beforeEach(async () => {
    // Set up test provider defaults
    setupTestProviderDefaults();

    // Create test provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      apiKey: 'test-anthropic-key',
    });

    // Create a separate project directory
    tempProjectDir = join(tempLaceDir.tempDir, 'test-project');
    mkdirSync(tempProjectDir, { recursive: true });

    // Create a project with provider configuration
    project = Project.create('Test Project', tempProjectDir, 'Test project for auto-resolve', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    // Create a session with projectId
    session = Session.create({
      name: 'Auto-Resolve Test Session',
      projectId: project.getId(),
      configuration: {},
    });

    // Create an agent with mocked tool executor
    const toolExecutor = new ToolExecutor();
    const threadManager = new ThreadManager();

    agent = new Agent({
      toolExecutor,
      threadManager,
      threadId: `${session.getId()}.1`,
      tools: [],
      metadata: {
        name: 'Test Agent',
        modelId: 'test-model',
        providerInstanceId: 'test-provider',
      },
    });

    // Add agent to session
    (session as any)._agents.set(agent.threadId, agent);

    // Mock getPendingApprovals
    vi.spyOn(agent, 'getPendingApprovals').mockReturnValue([
      {
        toolCallId: 'call-1',
        toolCall: {
          name: 'bash',
          arguments: { command: 'ls' },
        },
        requestedAt: new Date(),
      },
      {
        toolCallId: 'call-2',
        toolCall: {
          name: 'file_read',
          arguments: { path: 'test.txt' },
        },
        requestedAt: new Date(),
      },
      {
        toolCallId: 'call-3',
        toolCall: {
          name: 'file_write',
          arguments: { path: 'output.txt', content: 'test' },
        },
        requestedAt: new Date(),
      },
    ]);

    // Mock handleApprovalResponse
    vi.spyOn(agent, 'handleApprovalResponse').mockImplementation(() => {});

    // Mock toolExecutor.getTool
    vi.spyOn(agent.toolExecutor, 'getTool').mockImplementation((name) => {
      if (name === 'file_read' || name === 'file_list' || name === 'ripgrep_search') {
        return { name, annotations: { readOnlySafe: true } } as any;
      }
      return { name, annotations: {} } as any;
    });
  });

  afterEach(async () => {
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
    vi.clearAllMocks();
  });

  it('should auto-approve all pending approvals in yolo mode', () => {
    // Switch to yolo mode
    session.setPermissionOverrideMode('yolo');

    // Verify all pending approvals were auto-approved
    expect(agent.handleApprovalResponse).toHaveBeenCalledTimes(3);
    expect(agent.handleApprovalResponse).toHaveBeenCalledWith(
      'call-1',
      ApprovalDecision.ALLOW_ONCE
    );
    expect(agent.handleApprovalResponse).toHaveBeenCalledWith(
      'call-2',
      ApprovalDecision.ALLOW_ONCE
    );
    expect(agent.handleApprovalResponse).toHaveBeenCalledWith(
      'call-3',
      ApprovalDecision.ALLOW_ONCE
    );
  });

  it('should auto-approve only read-only safe tools in read-only mode', () => {
    // Switch to read-only mode
    session.setPermissionOverrideMode('read-only');

    // Verify correct approvals/denials
    expect(agent.handleApprovalResponse).toHaveBeenCalledTimes(3);

    // bash - not read-only safe, should be denied
    expect(agent.handleApprovalResponse).toHaveBeenCalledWith('call-1', ApprovalDecision.DENY);

    // file_read - read-only safe, should be approved
    expect(agent.handleApprovalResponse).toHaveBeenCalledWith(
      'call-2',
      ApprovalDecision.ALLOW_ONCE
    );

    // file_write - not read-only safe, should be denied
    expect(agent.handleApprovalResponse).toHaveBeenCalledWith('call-3', ApprovalDecision.DENY);
  });

  it('should not auto-resolve approvals when switching to normal mode', () => {
    // First switch to yolo mode
    session.setPermissionOverrideMode('yolo');

    // Clear previous calls
    vi.clearAllMocks();

    // Switch back to normal mode
    session.setPermissionOverrideMode('normal');

    // Verify no auto-resolution happened
    expect(agent.handleApprovalResponse).not.toHaveBeenCalled();
  });

  it('should handle sessions with no pending approvals gracefully', () => {
    // Mock no pending approvals
    vi.spyOn(agent, 'getPendingApprovals').mockReturnValue([]);

    // Should not throw when switching modes
    expect(() => session.setPermissionOverrideMode('yolo')).not.toThrow();
    expect(() => session.setPermissionOverrideMode('read-only')).not.toThrow();
    expect(() => session.setPermissionOverrideMode('normal')).not.toThrow();
  });

  it('should handle multiple agents in a session', () => {
    // Create a second agent
    const agent2 = new Agent({
      toolExecutor: new ToolExecutor(),
      threadManager: new ThreadManager(),
      threadId: `${session.getId()}.2`,
      tools: [],
      metadata: {
        name: 'Test Agent 2',
        modelId: 'test-model',
        providerInstanceId: 'test-provider',
      },
    });

    // Add second agent to session
    (session as any)._agents.set(agent2.threadId, agent2);

    // Mock pending approvals for second agent
    vi.spyOn(agent2, 'getPendingApprovals').mockReturnValue([
      {
        toolCallId: 'call-4',
        toolCall: {
          name: 'bash',
          arguments: { command: 'pwd' },
        },
        requestedAt: new Date(),
      },
    ]);

    vi.spyOn(agent2, 'handleApprovalResponse').mockImplementation(() => {});
    vi.spyOn(agent2.toolExecutor, 'getTool').mockImplementation(
      () => ({ name: 'bash', annotations: {} }) as any
    );

    // Switch to yolo mode
    session.setPermissionOverrideMode('yolo');

    // Verify both agents had their approvals resolved
    expect(agent.handleApprovalResponse).toHaveBeenCalledTimes(3);
    expect(agent2.handleApprovalResponse).toHaveBeenCalledTimes(1);
    expect(agent2.handleApprovalResponse).toHaveBeenCalledWith(
      'call-4',
      ApprovalDecision.ALLOW_ONCE
    );
  });
});
