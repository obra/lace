// ABOUTME: Tests for agent spawning behavior in both task creation and updates
// ABOUTME: Ensures assignment triggers spawning consistently across create and update operations

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskManager } from '~/tasks/task-manager';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { asThreadId, asNewAgentSpec, createNewAgentSpec } from '~/threads/types';
import { getPersistence, type DatabasePersistence } from '~/persistence/database';

describe('Agent Spawning on Assignment', () => {
  const _tempLaceDir = setupCoreTest();
  let taskManager: TaskManager;
  let persistence: DatabasePersistence;
  let sessionId: string;
  let mockAgentCreator: ReturnType<typeof vi.fn>;

  let delegateCounter: number;

  beforeEach(() => {
    persistence = getPersistence();
    sessionId = 'lace_20250727_abc456';
    delegateCounter = 1;

    // Mock agent creation callback
    mockAgentCreator = vi
      .fn()
      .mockImplementation((_persona: string, _provider: string, _model: string, _task: any) => {
        return Promise.resolve(asThreadId(`${sessionId}.${delegateCounter++}`));
      });

    taskManager = new TaskManager(asThreadId(sessionId), persistence, mockAgentCreator);
  });

  afterEach(() => {
    // Test cleanup handled by setupCoreTest
    vi.restoreAllMocks();
  });

  it('should spawn agent during task creation with new:persona:provider/model assignment', async () => {
    const taskContext = { actor: sessionId, isHuman: false };

    const task = await taskManager.createTask(
      {
        title: 'Test task creation',
        prompt: 'Test prompt',
        assignedTo: createNewAgentSpec('lace', 'anthropic', 'claude-3-5-haiku-20241022'),
      },
      taskContext
    );

    // Should have called agent creator
    expect(mockAgentCreator).toHaveBeenCalledWith(
      'lace',
      'anthropic',
      'claude-3-5-haiku-20241022',
      task
    );

    // Task should have delegate thread ID, not original assignment
    expect(task.assignedTo).toBe(`${sessionId}.1`);
    expect(task.assignedTo).not.toBe('new:lace:anthropic/claude-3-5-haiku-20241022');

    // Should be marked as in_progress due to agent spawning
    expect(task.status).toBe('in_progress');
  });

  it('should spawn agent during task update with new:provider/model assignment', async () => {
    const taskContext = { actor: sessionId, isHuman: false };

    // Create task without assignment
    const task = await taskManager.createTask(
      {
        title: 'Test task update',
        prompt: 'Test prompt',
      },
      taskContext
    );

    expect(task.assignedTo).toBeUndefined();
    expect(task.status).toBe('pending');
    expect(mockAgentCreator).not.toHaveBeenCalled();

    // Update task with assignment
    const updatedTask = await taskManager.updateTask(
      task.id,
      {
        assignedTo: createNewAgentSpec('lace', 'anthropic', 'claude-sonnet-4-20250514'),
        status: 'in_progress', // This will be overridden by agent spawning
      },
      taskContext
    );

    // Should have called agent creator
    expect(mockAgentCreator).toHaveBeenCalledWith(
      'lace',
      'anthropic',
      'claude-sonnet-4-20250514',
      updatedTask
    );

    // Task should have delegate thread ID, not original assignment
    expect(updatedTask.assignedTo).toBe(`${sessionId}.1`);
    expect(updatedTask.assignedTo).not.toBe('new:lace:anthropic/claude-sonnet-4-20250514');

    // Should be marked as in_progress due to agent spawning
    expect(updatedTask.status).toBe('in_progress');
  });

  it('should not spawn agent when assigning to existing thread ID', async () => {
    const taskContext = { actor: sessionId, isHuman: false };
    const existingThreadId = 'lace_20250727_def123';

    // Create task with existing thread assignment
    const task = await taskManager.createTask(
      {
        title: 'Test existing assignment',
        prompt: 'Test prompt',
        assignedTo: asThreadId(existingThreadId),
      },
      taskContext
    );

    // Should not have called agent creator
    expect(mockAgentCreator).not.toHaveBeenCalled();

    // Task should keep original assignment
    expect(task.assignedTo).toBe(existingThreadId);

    // Should remain pending (no auto-status change)
    expect(task.status).toBe('pending');
  });

  it('should handle agent creation failure gracefully', async () => {
    const taskContext = { actor: sessionId, isHuman: false };

    // Mock agent creator to throw error
    mockAgentCreator.mockRejectedValueOnce(new Error('Agent creation failed'));

    // Task creation should fail with descriptive error
    await expect(
      taskManager.createTask(
        {
          title: 'Test error handling',
          prompt: 'Test prompt',
          assignedTo: createNewAgentSpec('lace', 'anthropic', 'claude-3-5-haiku-20241022'),
        },
        taskContext
      )
    ).rejects.toThrow('Failed to spawn agent for task');
  });

  it('should spawn different agents for different assignments', async () => {
    const taskContext = { actor: sessionId, isHuman: false };

    // Create first task with one model
    const task1 = await taskManager.createTask(
      {
        title: 'Task 1',
        prompt: 'Prompt 1',
        assignedTo: createNewAgentSpec('lace', 'anthropic', 'claude-3-5-haiku-20241022'),
      },
      taskContext
    );

    // Create second task with different model
    const task2 = await taskManager.createTask(
      {
        title: 'Task 2',
        prompt: 'Prompt 2',
        assignedTo: createNewAgentSpec('lace', 'anthropic', 'claude-sonnet-4-20250514'),
      },
      taskContext
    );

    // Should have called agent creator twice with different models
    expect(mockAgentCreator).toHaveBeenCalledTimes(2);
    expect(mockAgentCreator).toHaveBeenNthCalledWith(
      1,
      'anthropic',
      'claude-3-5-haiku-20241022',
      task1
    );
    expect(mockAgentCreator).toHaveBeenNthCalledWith(
      2,
      'anthropic',
      'claude-sonnet-4-20250514',
      task2
    );

    // Tasks should have different delegate thread IDs
    expect(task1.assignedTo).toBe(`${sessionId}.1`);
    expect(task2.assignedTo).toBe(`${sessionId}.2`);
    expect(task1.assignedTo).not.toBe(task2.assignedTo);
  });
});
