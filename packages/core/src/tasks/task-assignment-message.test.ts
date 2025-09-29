// ABOUTME: Tests for validating that task assignment triggers initial message to agent
// ABOUTME: Ensures newly spawned agents receive task notification messages when assigned

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskManager } from '~/tasks/task-manager';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { setupCoreTest, cleanupSession } from '~/test-utils/core-test-setup';
import { asThreadId, createNewAgentSpec } from '~/threads/types';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';

// Enhanced mock provider that captures messages
class MessageCapturingProvider extends BaseMockProvider {
  public capturedMessages: ProviderMessage[] = [];

  constructor() {
    super({});
  }

  get providerName(): string {
    return 'mock';
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
        description: 'Model for testing',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        capabilities: ['function-calling'],
        isDefault: true,
      },
    ];
  };

  async createResponse(messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    // Capture all messages for inspection
    this.capturedMessages.push(...messages);

    // Look for task assignment message
    const taskMessage = messages.find(
      (m) =>
        m.content &&
        typeof m.content === 'string' &&
        m.content.includes('[LACE TASK SYSTEM] You have been assigned task')
    );

    if (taskMessage) {
      const match = taskMessage.content.match(/assigned task '([^']+)'/);
      const taskId = match ? match[1] : 'unknown';

      return Promise.resolve({
        content: `Acknowledged task assignment for task ${taskId}`,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        toolCalls: [],
      });
    }

    return Promise.resolve({
      content: 'Mock response',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    });
  }
}

describe('Task Assignment Message Sending', () => {
  const _tempLaceDir = setupCoreTest();
  let session: Session;
  let project: Project;
  let mockProvider: MessageCapturingProvider;
  let providerInstanceId: string;
  let taskManager: TaskManager;

  beforeEach(async () => {
    // Setup provider defaults
    setupTestProviderDefaults();

    // Create a standard test provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Task Message Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create mock provider
    mockProvider = new MessageCapturingProvider();

    // Mock the Agent's internal provider creation to use our message-capturing provider
    const { Agent } = await import('~/agents/agent');
    // @ts-expect-error: accessing private method for test-only provider injection
    vi.spyOn(
      Agent.prototype as unknown as { _createProviderInstance: () => Promise<unknown> },
      '_createProviderInstance'
    ).mockResolvedValue(mockProvider);

    // Create project and session
    project = Project.create(
      'Test Task Assignment Project',
      '/tmp/test-task-assignment',
      'Test project for task assignment message testing',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );

    session = Session.create({
      name: 'Task Assignment Message Test Session',
      projectId: project.getId(),
    });

    // Get task manager from session
    taskManager = session.getTaskManager()!;
  });

  afterEach(async () => {
    if (session) {
      await cleanupSession(session);
    }
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }
    cleanupTestProviderDefaults();
    vi.restoreAllMocks();
  });

  it('should send initial task assignment message when creating task with new agent', async () => {
    const taskContext = { actor: session.getId(), isHuman: false };

    // Clear any previous messages
    mockProvider.capturedMessages = [];

    // Create task with new agent assignment
    const task = await taskManager.createTask(
      {
        title: 'Test task with agent',
        prompt: 'This is a test task that should trigger agent creation',
        assignedTo: createNewAgentSpec('lace', `${providerInstanceId}:claude-3-5-haiku-20241022`),
      },
      taskContext
    );

    // Verify task was created with delegate assignment
    expect(task.assignedTo).toMatch(/^lace_\d{8}_\w+\.\d+$/);
    expect(task.status).toBe('in_progress');

    // Wait a bit for async message sending
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check that the initial task assignment message was sent
    const taskAssignmentMessage = mockProvider.capturedMessages.find(
      (msg) =>
        msg.content &&
        typeof msg.content === 'string' &&
        msg.content.includes('[LACE TASK SYSTEM] You have been assigned task')
    );

    expect(taskAssignmentMessage).toBeDefined();
    expect(taskAssignmentMessage?.role).toBe('user');
    expect(taskAssignmentMessage?.content).toContain(`task '${task.id}'`);
    expect(taskAssignmentMessage?.content).toContain(task.title);
    expect(taskAssignmentMessage?.content).toContain(task.prompt);
    expect(taskAssignmentMessage?.content).toContain('Use your task_add_note tool');
    expect(taskAssignmentMessage?.content).toContain('task_complete tool when you are done');
  });

  it('should send initial message when updating task with new agent assignment', async () => {
    const taskContext = { actor: session.getId(), isHuman: false };

    // Create task without assignment
    const task = await taskManager.createTask(
      {
        title: 'Test task for update',
        prompt: 'This task will be assigned later',
      },
      taskContext
    );

    expect(task.assignedTo).toBeUndefined();
    expect(task.status).toBe('pending');

    // Clear messages before update
    mockProvider.capturedMessages = [];

    // Update task with new agent assignment
    const updatedTask = await taskManager.updateTask(
      task.id,
      {
        assignedTo: createNewAgentSpec('lace', `${providerInstanceId}:claude-3-5-haiku-20241022`),
      },
      taskContext
    );

    // Verify task was updated with delegate assignment
    expect(updatedTask.assignedTo).toMatch(/^lace_\d{8}_\w+\.\d+$/);
    expect(updatedTask.status).toBe('in_progress');

    // Wait a bit for async message sending
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check that the initial task assignment message was sent
    const taskAssignmentMessage = mockProvider.capturedMessages.find(
      (msg) =>
        msg.content &&
        typeof msg.content === 'string' &&
        msg.content.includes('[LACE TASK SYSTEM] You have been assigned task')
    );

    expect(taskAssignmentMessage).toBeDefined();
    expect(taskAssignmentMessage?.role).toBe('user');
    expect(taskAssignmentMessage?.content).toContain(`task '${updatedTask.id}'`);
    expect(taskAssignmentMessage?.content).toContain(updatedTask.title);
    expect(taskAssignmentMessage?.content).toContain(updatedTask.prompt);
  });

  it('should not send message when assigning to existing thread', async () => {
    const taskContext = { actor: session.getId(), isHuman: false };
    const existingThreadId = 'lace_20250727_def123';

    // Clear messages
    mockProvider.capturedMessages = [];

    // Create task with existing thread assignment
    const task = await taskManager.createTask(
      {
        title: 'Test task with existing thread',
        prompt: 'This should not trigger agent creation',
        assignedTo: asThreadId(existingThreadId),
      },
      taskContext
    );

    // Verify task was created with original assignment
    expect(task.assignedTo).toBe(existingThreadId);
    expect(task.status).toBe('pending');

    // Wait a bit to ensure no async message sending occurs
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check that no task assignment message was sent
    const taskAssignmentMessage = mockProvider.capturedMessages.find(
      (msg) =>
        msg.content &&
        typeof msg.content === 'string' &&
        msg.content.includes('[LACE TASK SYSTEM] You have been assigned task')
    );

    expect(taskAssignmentMessage).toBeUndefined();
  });

  it('should reject task_create with wrong parameter name (assignTo instead of assignedTo)', async () => {
    // Get the tool executor from session
    const agent = session.getAgent(session.getId());
    const toolExecutor = agent!.toolExecutor;

    // Try to use task_create with wrong parameter name
    const toolCall = {
      id: 'call_wrong_param',
      name: 'task_create',
      arguments: {
        tasks: [
          {
            title: 'Test task',
            prompt: 'Do something',
            assignTo: 'new:lace;fast', // Wrong: should be assignedTo
          },
        ],
      },
    };

    // Execute through tool executor to get validation error
    const result = await toolExecutor.execute(toolCall, {
      signal: new AbortController().signal,
      agent,
    });

    // Should get a validation error
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('ValidationError: task_create failed');
    expect(result.content[0].text).toContain('Unexpected parameters: assignTo');

    // The agent should receive this as a TOOL_RESULT with failed status
    // which allows it to correct itself
  });
});
