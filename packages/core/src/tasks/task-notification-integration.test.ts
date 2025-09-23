// ABOUTME: Real integration tests for task notification system
// ABOUTME: Tests actual Session→TaskManager→Agent flow with notification delivery verification

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { Agent } from '~/agents/agent';
import type { ThreadId } from '~/threads/types';
import type { CreateTaskRequest, TaskContext } from '~/tasks/types';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import {
  cleanupTestProviderInstances,
  createTestProviderInstance,
} from '~/test-utils/provider-instances';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ApprovalDecision } from '~/tools/types';

// Mock provider with scripted responses
class MockNotificationProvider extends BaseMockProvider {
  constructor() {
    super({});
  }

  get providerName(): string {
    return 'mock-notification';
  }

  get defaultModel(): string {
    return 'claude-3-5-haiku-20241022';
  }

  get contextWindow(): number {
    return 200000;
  }

  get maxOutputTokens(): number {
    return 4096;
  }

  getAvailableModels = () => {
    return [
      {
        id: 'claude-3-5-haiku-20241022',
        displayName: 'Claude 3.5 Haiku',
        description: 'Test model',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        capabilities: ['function-calling'],
        isDefault: true,
      },
    ];
  };

  async createResponse(messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    // Simple acknowledgment response
    return Promise.resolve({
      content: 'Acknowledged',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    });
  }

  async *streamChat(messages: ProviderMessage[], tools: Tool[]): AsyncGenerator<any> {
    const response = await this.createResponse(messages, tools);
    yield { type: 'text', text: response.content };
  }
}

describe('Task Notification System - Real Integration', () => {
  const _tempLaceDir = setupCoreTest();
  let project: Project;
  let session: Session;
  let providerInstanceId: string;
  let sessionAgent: Agent;
  let mockProvider: MockNotificationProvider;

  // Create mock agents to simulate multiple sessions
  let creatorAgent: Agent;
  let assigneeAgent: Agent;
  let creatorSendMessageSpy: any;
  let assigneeSendMessageSpy: any;

  beforeEach(async () => {
    setupTestProviderDefaults();

    // Create a real provider instance for testing
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Notification Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create mock provider with scripted responses
    mockProvider = new MockNotificationProvider();

    // Mock the Agent's provider creation to use our mock
    vi.spyOn(Agent.prototype, '_createProviderInstance' as any).mockResolvedValue(mockProvider);

    // Create project
    project = Project.create(
      'Notification Test Project',
      '/tmp/test-notifications',
      'Test project for task notifications',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );

    // Create a single session
    session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
      approvalCallback: {
        requestApproval: async () => Promise.resolve(ApprovalDecision.ALLOW_ONCE),
      },
    });

    // Get the session's agent
    sessionAgent = session.getAgent(session.getId())!;

    // Create mock agents to represent creator and assignee
    creatorAgent = Object.create(sessionAgent);
    assigneeAgent = Object.create(sessionAgent);

    // Mock sendMessage on the mock agents
    creatorSendMessageSpy = vi.fn();
    assigneeSendMessageSpy = vi.fn();
    creatorAgent.sendMessage = creatorSendMessageSpy;
    assigneeAgent.sendMessage = assigneeSendMessageSpy;

    // Mock the session's _agents map to return our mock agents
    const originalGet = session['_agents'].get.bind(session['_agents']);
    vi.spyOn(session['_agents'], 'get').mockImplementation((threadId: ThreadId) => {
      if (threadId === 'creator_thread') {
        return creatorAgent;
      } else if (threadId === 'assignee_thread') {
        return assigneeAgent;
      }
      return originalGet(threadId);
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    session?.destroy();
    cleanupTestProviderDefaults();
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }
  });

  it('should deliver task assignment notification to assignee agent', async () => {
    const taskManager = session.getTaskManager();
    const creatorContext: TaskContext = {
      actor: 'creator_thread' as ThreadId,
      isHuman: false,
    };

    // Create task assigned to assignee
    const createRequest: CreateTaskRequest = {
      title: 'Review PR #123',
      description: 'Review the authentication refactor pull request',
      prompt: 'Please review PR #123 and provide feedback on the authentication implementation',
      priority: 'high',
      assignedTo: 'assignee_thread' as ThreadId,
    };

    const task = await taskManager.createTask(createRequest, creatorContext);

    // Wait for async notification processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify assignee agent's sendMessage was called with the notification
    expect(assigneeSendMessageSpy).toHaveBeenCalled();
    const notificationCall = assigneeSendMessageSpy.mock.calls[0];
    expect(notificationCall[0]).toContain('[LACE TASK SYSTEM]');
    expect(notificationCall[0]).toContain(task.id);
    expect(notificationCall[0]).toContain('Review PR #123');
    expect(notificationCall[0]).toContain('You have been assigned');
    expect(notificationCall[0]).toContain('high');
  });

  it('should deliver completion notification to creator agent', async () => {
    const taskManager = session.getTaskManager();
    const creatorContext: TaskContext = {
      actor: 'creator_thread' as ThreadId,
      isHuman: false,
    };
    const assigneeContext: TaskContext = {
      actor: 'assignee_thread' as ThreadId,
      isHuman: false,
    };

    // Create task
    const createRequest: CreateTaskRequest = {
      title: 'Fix bug #456',
      description: 'Fix the login timeout issue',
      prompt:
        'Users are getting logged out after 5 minutes. Fix the session timeout configuration.',
      priority: 'medium',
      assignedTo: 'assignee_thread' as ThreadId,
    };

    const task = await taskManager.createTask(createRequest, creatorContext);

    // Wait for initial assignment notification
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Clear spy calls
    creatorSendMessageSpy.mockClear();
    assigneeSendMessageSpy.mockClear();

    // Assignee completes the task
    await taskManager.updateTask(task.id, { status: 'completed' }, assigneeContext);

    // Wait for completion notification
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify creator agent's sendMessage was called with completion notification
    expect(creatorSendMessageSpy).toHaveBeenCalled();
    const completionCall = creatorSendMessageSpy.mock.calls[0];
    expect(completionCall[0]).toContain('completed');
    expect(completionCall[0]).toContain(task.id);
    expect(completionCall[0]).toContain('Fix bug #456');
    expect(completionCall[0]).toContain('✅');
    expect(completionCall[0]).toContain('review the results');
  });

  it('should deliver status change notifications to creator agent', async () => {
    const taskManager = session.getTaskManager();
    const creatorContext: TaskContext = {
      actor: 'creator_thread' as ThreadId,
      isHuman: false,
    };
    const assigneeContext: TaskContext = {
      actor: 'assignee_thread' as ThreadId,
      isHuman: false,
    };

    // Create task
    const createRequest: CreateTaskRequest = {
      title: 'Implement feature X',
      description: 'Add new dashboard widget',
      prompt: 'Create a widget showing user activity metrics',
      priority: 'low',
      assignedTo: 'assignee_thread' as ThreadId,
    };

    const task = await taskManager.createTask(createRequest, creatorContext);

    // Wait for assignment notification
    await new Promise((resolve) => setTimeout(resolve, 100));
    creatorSendMessageSpy.mockClear();
    assigneeSendMessageSpy.mockClear();

    // Update to in_progress
    await taskManager.updateTask(task.id, { status: 'in_progress' }, assigneeContext);

    // Wait for status notification
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify creator received in_progress notification
    expect(creatorSendMessageSpy).toHaveBeenCalled();
    const progressCall = creatorSendMessageSpy.mock.calls[0];
    expect(progressCall[0]).toContain('in_progress');
    expect(progressCall[0]).toContain(task.id);
    expect(progressCall[0]).toContain('🔄');
    expect(progressCall[0]).toContain('started working');

    creatorSendMessageSpy.mockClear();

    // Update to blocked
    await taskManager.updateTask(task.id, { status: 'blocked' }, assigneeContext);

    // Wait for blocked notification
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify creator received blocked notification
    expect(creatorSendMessageSpy).toHaveBeenCalled();
    const blockedCall = creatorSendMessageSpy.mock.calls[0];
    expect(blockedCall[0]).toContain('blocked');
    expect(blockedCall[0]).toContain(task.id);
    expect(blockedCall[0]).toContain('⛔');
    expect(blockedCall[0]).toContain('encountered an issue');
  });

  it('should deliver note notifications for significant notes', async () => {
    const taskManager = session.getTaskManager();
    const creatorContext: TaskContext = {
      actor: 'creator_thread' as ThreadId,
      isHuman: false,
    };
    const assigneeContext: TaskContext = {
      actor: 'assignee_thread' as ThreadId,
      isHuman: false,
    };

    // Create task
    const createRequest: CreateTaskRequest = {
      title: 'Research topic Y',
      description: 'Research implementation options',
      prompt: 'Research and document the best approach for implementing feature Y',
      priority: 'medium',
      assignedTo: 'assignee_thread' as ThreadId,
    };

    const task = await taskManager.createTask(createRequest, creatorContext);

    // Wait for assignment
    await new Promise((resolve) => setTimeout(resolve, 100));
    creatorSendMessageSpy.mockClear();
    assigneeSendMessageSpy.mockClear();

    // Add significant note (>50 chars)
    const significantNote =
      'After researching multiple approaches, I recommend using GraphQL for the API layer due to its flexibility and strong typing support. This will provide better developer experience and reduce over-fetching issues.';
    await taskManager.addNote(task.id, significantNote, assigneeContext);

    // Wait for note notification
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify creator received note notification
    expect(creatorSendMessageSpy).toHaveBeenCalled();
    const noteCall = creatorSendMessageSpy.mock.calls[0];
    expect(noteCall[0]).toContain('New note added');
    expect(noteCall[0]).toContain(task.id);
    expect(noteCall[0]).toContain(significantNote);

    creatorSendMessageSpy.mockClear();

    // Add trivial note (<50 chars) - should NOT trigger notification
    const trivialNote = 'Started working';
    await taskManager.addNote(task.id, trivialNote, assigneeContext);

    // Wait briefly
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify no notification for trivial note
    expect(creatorSendMessageSpy).not.toHaveBeenCalled();
  });

  it('should not notify creator when they complete their own task', async () => {
    const taskManager = session.getTaskManager();
    const creatorContext: TaskContext = {
      actor: 'creator_thread' as ThreadId,
      isHuman: false,
    };

    // Create task without assignment (creator will complete it)
    const createRequest: CreateTaskRequest = {
      title: 'Quick fix',
      description: 'Fix typo in README',
      prompt: 'Fix the typo in the installation section of README.md',
      priority: 'low',
    };

    const task = await taskManager.createTask(createRequest, creatorContext);

    // Clear any creation-related calls
    creatorSendMessageSpy.mockClear();

    // Creator completes their own task
    await taskManager.updateTask(task.id, { status: 'completed' }, creatorContext);

    // Wait briefly
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify no self-notification was sent
    expect(creatorSendMessageSpy).not.toHaveBeenCalled();
  });

  it('should handle task reassignment with notifications to both old and new assignee', async () => {
    const newAssigneeAgent = Object.create(sessionAgent);
    const newAssigneeSendMessageSpy = vi.fn();
    newAssigneeAgent.sendMessage = newAssigneeSendMessageSpy;

    // Update the mock to include the new assignee agent
    vi.spyOn(session['_agents'], 'get').mockImplementation((threadId: ThreadId) => {
      if (threadId === 'creator_thread') {
        return creatorAgent;
      } else if (threadId === 'assignee_thread') {
        return assigneeAgent;
      } else if (threadId === 'new_assignee_thread') {
        return newAssigneeAgent;
      }
      return session['_agents'].get(threadId) || null;
    });

    const taskManager = session.getTaskManager();
    const creatorContext: TaskContext = {
      actor: 'creator_thread' as ThreadId,
      isHuman: false,
    };

    // Create task initially assigned to first assignee
    const createRequest: CreateTaskRequest = {
      title: 'Complex task',
      description: 'Task that needs reassignment',
      prompt: 'This task requires special expertise',
      priority: 'high',
      assignedTo: 'assignee_thread' as ThreadId,
    };

    const task = await taskManager.createTask(createRequest, creatorContext);

    // Wait for initial assignment
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Clear spies
    assigneeSendMessageSpy.mockClear();
    newAssigneeSendMessageSpy.mockClear();

    // Reassign task to new assignee
    await taskManager.updateTask(
      task.id,
      { assignedTo: 'new_assignee_thread' as ThreadId },
      creatorContext
    );

    // Wait for reassignment notifications
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify old assignee received reassignment notification
    expect(assigneeSendMessageSpy).toHaveBeenCalled();
    const reassignmentCall = assigneeSendMessageSpy.mock.calls[0];
    expect(reassignmentCall[0]).toContain('reassigned');
    expect(reassignmentCall[0]).toContain('no longer responsible');

    // Verify new assignee received assignment notification
    expect(newAssigneeSendMessageSpy).toHaveBeenCalled();
    const assignmentCall = newAssigneeSendMessageSpy.mock.calls[0];
    expect(assignmentCall[0]).toContain('[LACE TASK SYSTEM]');
    expect(assignmentCall[0]).toContain('You have been assigned');
  });
});
