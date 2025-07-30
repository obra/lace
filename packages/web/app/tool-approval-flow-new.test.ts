// ABOUTME: Updated integration test for event-based tool approval system
// ABOUTME: Tests the complete path from tool execution to ThreadManager events

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSessionService } from '@/lib/server/session-service';
import { Agent, Project } from '@/lib/server/lace-imports';
import { type ThreadId } from '@/lib/server/core-types';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// Use real file-read tool for testing
import { FileReadTool } from '~/tools/implementations/file-read';

describe('Event-Based Tool Approval Integration', () => {
  let sessionService: ReturnType<typeof getSessionService>;
  let projectId: string;
  let sessionId: ThreadId;
  let agent: Agent;
  let tempDir: string;

  beforeEach(async () => {
    // Set up test persistence
    setupTestPersistence();

    // Create temp directory
    tempDir = await mkdtemp(join(tmpdir(), 'lace-approval-test-'));

    // Create a test file for reading
    await writeFile(
      join(tempDir, 'test-file.txt'),
      'This is test content for approval flow testing'
    );

    // Set up environment
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    // Initialize services
    sessionService = getSessionService();

    // Create a test project
    const project = Project.create(
      'Tool Approval Test Project',
      'Project for testing tool approval flow',
      tempDir
    );
    projectId = project.getId();

    // Create a test session
    const session = await sessionService.createSession(
      'Tool Approval Test Session',
      'anthropic',
      'claude-3-5-haiku-20241022',
      projectId
    );
    sessionId = session.id;

    // Get the session and its coordinator agent
    const sessionInstance = await sessionService.getSession(sessionId);
    if (!sessionInstance) {
      throw new Error('Failed to get session instance');
    }

    // Get the coordinator agent (every session has one)
    const agentResult = sessionInstance.getAgent(sessionId);
    if (!agentResult) {
      throw new Error('Failed to get coordinator agent');
    }
    agent = agentResult;

    // Register file-read tool
    const fileReadTool = new FileReadTool();
    agent.toolExecutor.registerTool('file-read', fileReadTool);
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true });
    }
    teardownTestPersistence();
  });

  it('should create TOOL_APPROVAL_REQUEST event when tool requires approval', async () => {
    // First create a TOOL_CALL event (this would normally happen during tool execution)
    const testFilePath = join(tempDir, 'test-file.txt');
    const toolCall = {
      id: 'test-call-123',
      name: 'file-read',
      arguments: { path: testFilePath },
    };

    // Add TOOL_CALL event to thread
    agent.threadManager.addEvent(agent.threadId, 'TOOL_CALL', toolCall);

    // Get the approval callback that was set up
    const toolExecutor = agent.toolExecutor as unknown as {
      approvalCallback?: {
        requestApproval: (toolName: string, input: unknown) => Promise<string>;
      };
    };

    expect(toolExecutor.approvalCallback).toBeDefined();
    if (!toolExecutor.approvalCallback) {
      throw new Error('Approval callback not found');
    }

    // Start approval request (this should create TOOL_APPROVAL_REQUEST event and throw ApprovalPendingError)
    try {
      await toolExecutor.approvalCallback.requestApproval({
        id: 'test-call-123',
        name: 'file-read',
        arguments: {
          file_path: testFilePath,
        },
      });
      throw new Error('Expected ApprovalPendingError to be thrown');
    } catch (error: unknown) {
      // Verify that ApprovalPendingError was thrown with correct toolCallId
      expect(error).toBeInstanceOf(Error);
      const approvalError = error as { toolCallId?: string };
      expect(approvalError.toolCallId).toBe('test-call-123');
    }

    // Verify TOOL_APPROVAL_REQUEST event was created
    const events = agent.threadManager.getEvents(agent.threadId);
    const approvalRequestEvent = events.find((e) => e.type === 'TOOL_APPROVAL_REQUEST');
    expect(approvalRequestEvent).toBeDefined();
    expect((approvalRequestEvent?.data as { toolCallId: string }).toolCallId).toBe('test-call-123');
  });

  it('should return existing approval if response already exists', async () => {
    const testFilePath = join(tempDir, 'test-file.txt');
    const toolCall = {
      id: 'existing-call-456',
      name: 'file-read',
      arguments: { path: testFilePath },
    };

    // Add TOOL_CALL and existing TOOL_APPROVAL_RESPONSE events
    agent.threadManager.addEvent(agent.threadId, 'TOOL_CALL', toolCall);
    agent.threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'existing-call-456',
      decision: 'allow_session',
    });

    // Get the approval callback
    const toolExecutor = agent.toolExecutor as unknown as {
      approvalCallback?: {
        requestApproval: (toolName: string, input: unknown) => Promise<string>;
      };
    };

    expect(toolExecutor.approvalCallback).toBeDefined();
    if (!toolExecutor.approvalCallback) {
      throw new Error('Approval callback not found');
    }

    // Request approval - should return existing decision immediately
    const decision = await toolExecutor.approvalCallback.requestApproval({
      id: 'existing-call-456',
      name: 'file-read',
      arguments: {
        file_path: testFilePath,
      },
    });

    expect(decision).toBe('allow_session');

    // Should not create additional TOOL_APPROVAL_REQUEST event
    const events = agent.threadManager.getEvents(agent.threadId);
    const requestEvents = events.filter((e) => e.type === 'TOOL_APPROVAL_REQUEST');
    expect(requestEvents).toHaveLength(0); // No new request should be created
  });

  it('should handle getPendingApprovals query correctly', async () => {
    const testFilePath = join(tempDir, 'test-file.txt');

    // Create TOOL_CALL and TOOL_APPROVAL_REQUEST events
    const toolCall = {
      id: 'pending-call-789',
      name: 'file-read',
      arguments: { path: testFilePath },
    };

    agent.threadManager.addEvent(agent.threadId, 'TOOL_CALL', toolCall);
    agent.threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_REQUEST', {
      toolCallId: 'pending-call-789',
    });

    // Query pending approvals using ThreadManager
    const pendingApprovals = agent.threadManager.getPendingApprovals(agent.threadId);

    expect(pendingApprovals).toHaveLength(1);
    expect(pendingApprovals[0].toolCallId).toBe('pending-call-789');
    expect((pendingApprovals[0].toolCall as { name: string }).name).toBe('file-read');

    // Add approval response
    agent.threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'pending-call-789',
      decision: 'deny',
    });

    // Now should have no pending approvals
    const afterResponseApprovals = agent.threadManager.getPendingApprovals(agent.threadId);
    expect(afterResponseApprovals).toHaveLength(0);
  });
});
