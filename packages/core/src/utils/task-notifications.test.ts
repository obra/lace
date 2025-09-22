import { describe, it, expect, vi } from 'vitest';
import type { TaskNotification } from './task-notifications';
import { routeTaskNotifications } from './task-notifications';
import { asThreadId } from '~/threads/types';

describe('Task Notification Types', () => {
  it('should compile notification types correctly', () => {
    // Just test that types compile - no runtime logic yet
    const notification: TaskNotification = {
      threadId: 'lace_20250922_test01' as any,
      message: 'test',
      notificationType: 'completion',
      taskId: 'task_123',
      priority: 'immediate',
    };
    expect(notification).toBeDefined();
  });
});

describe('Task Notification Routing', () => {
  const sessionId = asThreadId('lace_20250922_test01');
  const creatorAgent = asThreadId('lace_20250922_test01.1');
  const assigneeAgent = asThreadId('lace_20250922_test01.2');

  it('should notify creator when task completed by different agent', async () => {
    const mockAgent = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    const mockGetAgent = vi.fn().mockReturnValue(mockAgent);

    const taskEvent = {
      type: 'task:updated' as const,
      task: {
        id: 'task_123',
        title: 'Test Task',
        status: 'completed' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Do something important',
        priority: 'medium' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      },
      context: { actor: assigneeAgent },
      timestamp: new Date(),
    };

    await routeTaskNotifications(taskEvent, {
      getAgent: mockGetAgent,
      sessionId,
    });

    // Verify creator was notified
    expect(mockGetAgent).toHaveBeenCalledWith(creatorAgent);
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('completed'));
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining(taskEvent.task.title)
    );
  });

  it('should notify assignee when task is assigned to them', async () => {
    const mockAgent = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    const mockGetAgent = vi.fn().mockReturnValue(mockAgent);

    const taskEvent = {
      type: 'task:created' as const,
      task: {
        id: 'task_456',
        title: 'New Assignment',
        status: 'pending' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Please work on this',
        priority: 'high' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      },
      context: { actor: creatorAgent },
      timestamp: new Date(),
    };

    await routeTaskNotifications(taskEvent, {
      getAgent: mockGetAgent,
      sessionId,
    });

    // Verify assignee was notified
    expect(mockGetAgent).toHaveBeenCalledWith(assigneeAgent);
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('[LACE TASK SYSTEM]')
    );
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('assigned'));
  });
});
