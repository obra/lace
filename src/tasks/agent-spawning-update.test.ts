// ABOUTME: Tests for agent spawning behavior in both task creation and updates
// ABOUTME: Ensures assignment triggers spawning consistently across create and update operations

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskManager } from '~/tasks/task-manager';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { asThreadId } from '~/threads/types';
import type { DatabasePersistence } from '~/persistence/database';

describe('Agent Spawning on Assignment', () => {
  let taskManager: TaskManager;
  let persistence: DatabasePersistence;
  let sessionId: string;
  let mockAgentCreator: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    persistence = setupTestPersistence();
    sessionId = 'lace_20250727_test456';

    // Mock agent creation callback
    mockAgentCreator = vi.fn().mockImplementation((provider: string, model: string) => {
      return Promise.resolve(
        asThreadId(`${sessionId}.delegate_${provider}_${model}_${Date.now()}`)
      );
    });

    taskManager = new TaskManager(asThreadId(sessionId), persistence, mockAgentCreator);
  });

  afterEach(() => {
    persistence.close();
    teardownTestPersistence();
    vi.restoreAllMocks();
  });

  it('should spawn agent during task creation with new:provider/model assignment', async () => {
    const taskContext = { actor: sessionId, isHuman: false };

    const task = await taskManager.createTask(
      {
        title: 'Test task creation',
        prompt: 'Test prompt',
        assignedTo: 'new:anthropic/claude-3-5-haiku-20241022',
      },
      taskContext
    );

    // Should have called agent creator
    expect(mockAgentCreator).toHaveBeenCalledWith('anthropic', 'claude-3-5-haiku-20241022', task);

    // Task should have delegate thread ID, not original assignment
    expect(task.assignedTo).toContain(`${sessionId}.delegate_anthropic_claude-3-5-haiku-20241022_`);
    expect(task.assignedTo).not.toBe('new:anthropic/claude-3-5-haiku-20241022');

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
        assignedTo: 'new:anthropic/claude-sonnet-4-20250514',
        status: 'in_progress', // This will be overridden by agent spawning
      },
      taskContext
    );

    // Should have called agent creator
    expect(mockAgentCreator).toHaveBeenCalledWith(
      'anthropic',
      'claude-sonnet-4-20250514',
      updatedTask
    );

    // Task should have delegate thread ID, not original assignment
    expect(updatedTask.assignedTo).toContain(
      `${sessionId}.delegate_anthropic_claude-sonnet-4-20250514_`
    );
    expect(updatedTask.assignedTo).not.toBe('new:anthropic/claude-sonnet-4-20250514');

    // Should be marked as in_progress due to agent spawning
    expect(updatedTask.status).toBe('in_progress');
  });

  it('should not spawn agent when assigning to existing thread ID', async () => {
    const taskContext = { actor: sessionId, isHuman: false };
    const existingThreadId = 'lace_20250727_existing123';

    // Create task with existing thread assignment
    const task = await taskManager.createTask(
      {
        title: 'Test existing assignment',
        prompt: 'Test prompt',
        assignedTo: existingThreadId,
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
          assignedTo: 'new:anthropic/claude-3-5-haiku-20241022',
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
        assignedTo: 'new:anthropic/claude-3-5-haiku-20241022',
      },
      taskContext
    );

    // Create second task with different model
    const task2 = await taskManager.createTask(
      {
        title: 'Task 2',
        prompt: 'Prompt 2',
        assignedTo: 'new:anthropic/claude-sonnet-4-20250514',
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
    expect(task1.assignedTo).toContain('delegate_anthropic_claude-3-5-haiku-20241022_');
    expect(task2.assignedTo).toContain('delegate_anthropic_claude-sonnet-4-20250514_');
    expect(task1.assignedTo).not.toBe(task2.assignedTo);
  });
});
