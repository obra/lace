// ABOUTME: Real integration tests for task notification system
// ABOUTME: Tests actual Session→TaskManager→Agent flow with thread history verification

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { Agent } from '~/agents/agent';
import type { CreateTaskRequest, TaskContext } from '~/tasks/types';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { TestProvider } from '~/test-utils/test-provider';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import type { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import type { Tool } from '~/tools/tool';

// Create a mock provider that responds based on message content
class ScriptedMockProvider extends TestProvider {
  private responses: Array<{ trigger: string; response: string }> = [];

  constructor(config: { responses: Array<{ trigger: string; response: string }> }) {
    super({ delay: 10 });
    this.responses = config.responses;
  }

  async createResponse(
    messages: ProviderMessage[],
    _tools: Tool[],
    _model: string,
    _signal?: AbortSignal
  ): Promise<ProviderResponse> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Find the last user message
    const lastUserMessage = messages
      .slice()
      .reverse()
      .find((m) => m.role === 'user');

    if (!lastUserMessage || typeof lastUserMessage.content !== 'string') {
      return {
        content: 'I acknowledge your message.',
        toolCalls: [],
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        stopReason: 'end_turn',
      };
    }

    // Find a matching response based on triggers in the message
    const messageContent = lastUserMessage.content;
    for (const { trigger, response } of this.responses) {
      if (messageContent.includes(trigger)) {
        return {
          content: response,
          toolCalls: [],
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          stopReason: 'end_turn',
        };
      }
    }

    // Default response if no trigger matches
    return {
      content: 'I have received your message and will process it accordingly.',
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      stopReason: 'end_turn',
    };
  }
}

describe('Task Notification System - Real Integration', () => {
  const _tempDir = setupCoreTest();
  let project: Project;
  let mainSession: Session;
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();

    // Create a test provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Notification Instance',
      apiKey: 'test-anthropic-key',
    });

    // Use scripted test provider for agent responses
    const testProvider = new ScriptedMockProvider({
      responses: [
        {
          trigger: '[LACE TASK SYSTEM]',
          response: 'I acknowledge the task assignment and will begin work.',
        },
        {
          trigger: 'completed',
          response: 'I see the task has been completed. Reviewing the results.',
        },
        {
          trigger: 'in_progress',
          response: 'Noted that work has started on the task.',
        },
        {
          trigger: 'blocked',
          response: 'I understand there is a blocker. Let me help resolve it.',
        },
        {
          trigger: 'reassigned',
          response: 'Understood, I am no longer responsible for this task.',
        },
        {
          trigger: 'New note added',
          response: 'Thank you for the progress update.',
        },
      ],
    });

    // Mock Agent provider creation to use our test provider
    vi.spyOn(Agent.prototype, '_createProviderInstance' as any).mockResolvedValue(testProvider);

    // Create project
    project = Project.create(
      'Notification Test Project',
      '/tmp/test-notifications',
      'Test project for notification integration',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );

    // Create the main session
    mainSession = Session.create({
      name: 'Main Test Session',
      projectId: project.getId(),
      configuration: {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      },
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    mainSession?.destroy();
    cleanupTestProviderDefaults();
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }
  });

  it('should deliver task assignment notification and verify in thread history', async () => {
    // In the real system, all agents involved in task notifications would be spawned
    // within the same session. Let's simulate that by spawning agents in the main session.

    // Spawn creator agent within the main session
    const creatorAgent = await mainSession.spawnAgent(
      'task-creator',
      providerInstanceId,
      'claude-3-5-haiku-20241022'
    );
    const creatorThreadId = creatorAgent.threadId;

    // Spawn assignee agent within the main session
    const assigneeAgent = await mainSession.spawnAgent(
      'task-assignee',
      providerInstanceId,
      'claude-3-5-haiku-20241022'
    );
    const assigneeThreadId = assigneeAgent.threadId;

    // Start agents so they can receive messages
    await creatorAgent.start();
    await assigneeAgent.start();

    // Get the task manager from main session
    const taskManager = mainSession.getTaskManager();

    const creatorContext: TaskContext = {
      actor: creatorThreadId,
      isHuman: false,
    };

    // Create task assigned to assignee
    const createRequest: CreateTaskRequest = {
      title: 'Review PR #123',
      description: 'Review the authentication refactor pull request',
      prompt: 'Please review PR #123 and provide feedback on the authentication implementation',
      priority: 'high',
      assignedTo: assigneeThreadId,
    };

    const task = await taskManager.createTask(createRequest, creatorContext);

    // Wait for notification to be processed
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Get assignee's thread events
    const assigneeEvents = assigneeAgent.getLaceEvents(assigneeThreadId) || [];

    // Find the notification event
    const notificationEvent = assigneeEvents.find(
      (event) =>
        event.type === 'USER_MESSAGE' &&
        typeof event.data === 'string' &&
        event.data.includes('[LACE TASK SYSTEM]') &&
        event.data.includes(task.id)
    );

    expect(notificationEvent).toBeDefined();
    expect(notificationEvent?.data).toContain('You have been assigned');
    expect(notificationEvent?.data).toContain('Review PR #123');
    expect(notificationEvent?.data).toContain('high');

    // Verify agent responded to the notification
    const responseEvent = assigneeEvents.find(
      (event) =>
        event.type === 'AGENT_MESSAGE' &&
        event.data?.content?.includes('acknowledge the task assignment')
    );
    expect(responseEvent).toBeDefined();
  });

  it('should deliver completion notification to creator', async () => {
    // Spawn agents within the same session
    const creatorAgent = await mainSession.spawnAgent(
      'task-creator',
      providerInstanceId,
      'claude-3-5-haiku-20241022'
    );
    const creatorThreadId = creatorAgent.threadId;

    const assigneeAgent = await mainSession.spawnAgent(
      'task-assignee',
      providerInstanceId,
      'claude-3-5-haiku-20241022'
    );
    const assigneeThreadId = assigneeAgent.threadId;

    const taskManager = mainSession.getTaskManager();

    const creatorContext: TaskContext = {
      actor: creatorThreadId,
      isHuman: false,
    };
    const assigneeContext: TaskContext = {
      actor: assigneeThreadId,
      isHuman: false,
    };

    // Create task
    const createRequest: CreateTaskRequest = {
      title: 'Fix bug #456',
      description: 'Fix the login timeout issue',
      prompt:
        'Users are getting logged out after 5 minutes. Fix the session timeout configuration.',
      priority: 'medium',
      assignedTo: assigneeThreadId,
    };

    const task = await taskManager.createTask(createRequest, creatorContext);

    // Wait for assignment notification
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Get initial event count for creator
    const initialEventCount = creatorAgent.getLaceEvents(creatorThreadId).length || 0;

    // Assignee completes the task
    await taskManager.updateTask(task.id, { status: 'completed' }, assigneeContext);

    // Wait for completion notification
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Check creator's thread history for completion notification
    const creatorEvents = creatorAgent.getLaceEvents(creatorThreadId) || [];
    const newEvents = creatorEvents.slice(initialEventCount);

    const completionNotification = newEvents.find(
      (event) =>
        event.type === 'USER_MESSAGE' &&
        typeof event.data === 'string' &&
        event.data.includes('completed') &&
        event.data.includes(task.id)
    );

    expect(completionNotification).toBeDefined();
    expect(completionNotification?.data).toContain('Fix bug #456');
    expect(completionNotification?.data).toContain('✅');
    expect(completionNotification?.data).toContain('review the results');
  });

  it('should deliver status change notifications', async () => {
    // Spawn agents within the same session
    const creatorAgent = await mainSession.spawnAgent(
      'task-creator',
      providerInstanceId,
      'claude-3-5-haiku-20241022'
    );
    const creatorThreadId = creatorAgent.threadId;

    const assigneeAgent = await mainSession.spawnAgent(
      'task-assignee',
      providerInstanceId,
      'claude-3-5-haiku-20241022'
    );
    const assigneeThreadId = assigneeAgent.threadId;

    const taskManager = mainSession.getTaskManager();

    const creatorContext: TaskContext = {
      actor: creatorThreadId,
      isHuman: false,
    };
    const assigneeContext: TaskContext = {
      actor: assigneeThreadId,
      isHuman: false,
    };

    // Create task
    const createRequest: CreateTaskRequest = {
      title: 'Implement feature X',
      description: 'Add new dashboard widget',
      prompt: 'Create a widget showing user activity metrics',
      priority: 'low',
      assignedTo: assigneeThreadId,
    };

    const task = await taskManager.createTask(createRequest, creatorContext);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Update to in_progress
    await taskManager.updateTask(task.id, { status: 'in_progress' }, assigneeContext);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Check creator received in_progress notification
    const creatorEvents = creatorAgent.getLaceEvents(creatorThreadId) || [];

    const progressNotification = creatorEvents.find(
      (event) =>
        event.type === 'USER_MESSAGE' &&
        typeof event.data === 'string' &&
        event.data.includes('in_progress') &&
        event.data.includes(task.id)
    );

    expect(progressNotification).toBeDefined();
    expect(progressNotification?.data).toContain('🔄');
    expect(progressNotification?.data).toContain('started working');

    // Update to blocked
    await taskManager.updateTask(task.id, { status: 'blocked' }, assigneeContext);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Check for blocked notification
    const updatedEvents = creatorAgent.getLaceEvents(creatorThreadId) || [];
    const blockedNotification = updatedEvents.find(
      (event) =>
        event.type === 'USER_MESSAGE' &&
        typeof event.data === 'string' &&
        event.data.includes('blocked') &&
        event.data.includes(task.id)
    );

    expect(blockedNotification).toBeDefined();
    expect(blockedNotification?.data).toContain('⛔');
    expect(blockedNotification?.data).toContain('encountered an issue');
  });

  it('should deliver note notifications for significant notes only', async () => {
    // Spawn agents within the same session
    const creatorAgent = await mainSession.spawnAgent(
      'task-creator',
      providerInstanceId,
      'claude-3-5-haiku-20241022'
    );
    const creatorThreadId = creatorAgent.threadId;

    const assigneeAgent = await mainSession.spawnAgent(
      'task-assignee',
      providerInstanceId,
      'claude-3-5-haiku-20241022'
    );
    const assigneeThreadId = assigneeAgent.threadId;

    const taskManager = mainSession.getTaskManager();

    const creatorContext: TaskContext = {
      actor: creatorThreadId,
      isHuman: false,
    };
    const assigneeContext: TaskContext = {
      actor: assigneeThreadId,
      isHuman: false,
    };

    // Create task
    const createRequest: CreateTaskRequest = {
      title: 'Research topic Y',
      description: 'Research implementation options',
      prompt: 'Research and document the best approach for implementing feature Y',
      priority: 'medium',
      assignedTo: assigneeThreadId,
    };

    const task = await taskManager.createTask(createRequest, creatorContext);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const initialEventCount = creatorAgent.getLaceEvents(creatorThreadId).length || 0;

    // Add significant note (>50 chars)
    const significantNote =
      'After researching multiple approaches, I recommend using GraphQL for the API layer due to its flexibility and strong typing support.';
    await taskManager.addNote(task.id, significantNote, assigneeContext);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify creator received note notification
    const creatorEvents = creatorAgent.getLaceEvents(creatorThreadId) || [];
    const newEvents = creatorEvents.slice(initialEventCount);

    const noteNotification = newEvents.find(
      (event) =>
        event.type === 'USER_MESSAGE' &&
        typeof event.data === 'string' &&
        event.data.includes('New note added') &&
        event.data.includes(task.id)
    );

    expect(noteNotification).toBeDefined();
    expect(noteNotification?.data).toContain(significantNote);

    // Add trivial note (<50 chars)
    const preTriviaNoteCount = creatorAgent.getLaceEvents(creatorThreadId).length || 0;
    await taskManager.addNote(task.id, 'Started', assigneeContext);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify no notification for trivial note
    const postTrivialEvents = creatorAgent.getLaceEvents(creatorThreadId) || [];
    const trivialNoteEvents = postTrivialEvents.slice(preTriviaNoteCount);

    const trivialNotification = trivialNoteEvents.find(
      (event) =>
        event.type === 'USER_MESSAGE' &&
        typeof event.data === 'string' &&
        event.data.includes('Started')
    );

    expect(trivialNotification).toBeUndefined();
  });

  it('should not notify creator when they complete their own task', async () => {
    // Spawn creator agent within the main session
    const creatorAgent = await mainSession.spawnAgent(
      'task-creator',
      providerInstanceId,
      'claude-3-5-haiku-20241022'
    );
    const creatorThreadId = creatorAgent.threadId;

    const taskManager = mainSession.getTaskManager();

    const creatorContext: TaskContext = {
      actor: creatorThreadId,
      isHuman: false,
    };

    // Create task without assignment
    const createRequest: CreateTaskRequest = {
      title: 'Quick fix',
      description: 'Fix typo in README',
      prompt: 'Fix the typo in the installation section of README.md',
      priority: 'low',
    };

    const task = await taskManager.createTask(createRequest, creatorContext);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const initialEventCount = creatorAgent.getLaceEvents(creatorThreadId).length || 0;

    // Creator completes their own task
    await taskManager.updateTask(task.id, { status: 'completed' }, creatorContext);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify no self-notification
    const creatorEvents = creatorAgent.getLaceEvents(creatorThreadId) || [];
    const newEvents = creatorEvents.slice(initialEventCount);

    const selfNotification = newEvents.find(
      (event) =>
        event.type === 'USER_MESSAGE' &&
        typeof event.data === 'string' &&
        event.data.includes('completed') &&
        event.data.includes(task.id)
    );

    expect(selfNotification).toBeUndefined();
  });

  it('should handle task reassignment with notifications to both assignees', async () => {
    // Spawn all agents within the main session
    const creatorAgent = await mainSession.spawnAgent(
      'task-creator',
      providerInstanceId,
      'claude-3-5-haiku-20241022'
    );
    const creatorThreadId = creatorAgent.threadId;

    const oldAssigneeAgent = await mainSession.spawnAgent(
      'old-assignee',
      providerInstanceId,
      'claude-3-5-haiku-20241022'
    );
    const oldAssigneeThreadId = oldAssigneeAgent.threadId;

    const newAssigneeAgent = await mainSession.spawnAgent(
      'new-assignee',
      providerInstanceId,
      'claude-3-5-haiku-20241022'
    );
    const newAssigneeThreadId = newAssigneeAgent.threadId;

    const taskManager = mainSession.getTaskManager();

    const creatorContext: TaskContext = {
      actor: creatorThreadId,
      isHuman: false,
    };

    // Create task initially assigned to old assignee
    const createRequest: CreateTaskRequest = {
      title: 'Complex task',
      description: 'Task that needs reassignment',
      prompt: 'This task requires special expertise',
      priority: 'high',
      assignedTo: oldAssigneeThreadId,
    };

    const task = await taskManager.createTask(createRequest, creatorContext);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const oldAssigneeInitialCount = oldAssigneeAgent.getLaceEvents(oldAssigneeThreadId).length || 0;
    const newAssigneeInitialCount = newAssigneeAgent.getLaceEvents(newAssigneeThreadId).length || 0;

    // Reassign task
    await taskManager.updateTask(task.id, { assignedTo: newAssigneeThreadId }, creatorContext);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify old assignee received reassignment notification
    const oldAssigneeEvents = oldAssigneeAgent.getLaceEvents(oldAssigneeThreadId) || [];
    const oldAssigneeNewEvents = oldAssigneeEvents.slice(oldAssigneeInitialCount);

    const reassignmentNotification = oldAssigneeNewEvents.find(
      (event) =>
        event.type === 'USER_MESSAGE' &&
        typeof event.data === 'string' &&
        event.data.includes('reassigned') &&
        event.data.includes('no longer responsible')
    );

    expect(reassignmentNotification).toBeDefined();

    // Verify new assignee received assignment notification
    const newAssigneeEvents = newAssigneeAgent.getLaceEvents(newAssigneeThreadId) || [];
    const newAssigneeNewEvents = newAssigneeEvents.slice(newAssigneeInitialCount);

    const assignmentNotification = newAssigneeNewEvents.find(
      (event) =>
        event.type === 'USER_MESSAGE' &&
        typeof event.data === 'string' &&
        event.data.includes('[LACE TASK SYSTEM]') &&
        event.data.includes('You have been assigned')
    );

    expect(assignmentNotification).toBeDefined();
  });
});
