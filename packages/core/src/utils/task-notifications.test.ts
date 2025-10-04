// ABOUTME: Unit tests for task notification routing system
// ABOUTME: Tests notification logic for completion, assignment, status changes, and notes

import { describe, it, expect, vi } from 'vitest';
import type { TaskNotification } from './task-notifications';
import { routeTaskNotifications } from './task-notifications';
import { asThreadId } from '@lace/core/threads/types';

describe('Task Notification Types', () => {
  it('should compile notification types correctly', () => {
    // Just test that types compile - no runtime logic yet
    const notification: TaskNotification = {
      threadId: asThreadId('lace_20250922_test01'),
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
      previousTask: {
        id: 'task_123',
        title: 'Test Task',
        status: 'in_progress' as const,
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
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('completed'),
      expect.objectContaining({
        queue: true,
        metadata: expect.objectContaining({
          source: 'task_system',
          priority: 'high',
        }),
      })
    );
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining(taskEvent.task.title),
      expect.any(Object)
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
      expect.stringContaining('[LACE TASK SYSTEM]'),
      expect.objectContaining({
        queue: true,
        metadata: expect.objectContaining({
          source: 'task_system',
          priority: 'high',
        }),
      })
    );
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('assigned'),
      expect.any(Object)
    );
  });

  it('should notify both old and new assignee when task is reassigned', async () => {
    const oldAssignee = asThreadId('lace_20250922_test01.3');
    const mockNewAgent = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    const mockOldAgent = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    const mockGetAgent = vi.fn().mockImplementation((id) => {
      if (id === assigneeAgent) return mockNewAgent;
      if (id === oldAssignee) return mockOldAgent;
      return null;
    });

    const taskEvent = {
      type: 'task:updated' as const,
      task: {
        id: 'task_789',
        title: 'Reassigned Task',
        status: 'in_progress' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Important work',
        priority: 'high' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      },
      previousTask: {
        id: 'task_789',
        title: 'Reassigned Task',
        status: 'in_progress' as const,
        createdBy: creatorAgent,
        assignedTo: oldAssignee,
        prompt: 'Important work',
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

    // Verify new assignee was notified
    expect(mockGetAgent).toHaveBeenCalledWith(assigneeAgent);
    expect(mockNewAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('[LACE TASK SYSTEM]'),
      expect.objectContaining({
        queue: true,
        metadata: expect.objectContaining({
          source: 'task_system',
          priority: 'high',
        }),
      })
    );
    expect(mockNewAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('assigned'),
      expect.any(Object)
    );

    // Verify old assignee was notified about reassignment
    expect(mockGetAgent).toHaveBeenCalledWith(oldAssignee);
    expect(mockOldAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('reassigned'),
      expect.objectContaining({
        queue: true,
        metadata: expect.objectContaining({
          source: 'task_system',
          priority: 'normal',
        }),
      })
    );
    expect(mockOldAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('no longer responsible'),
      expect.any(Object)
    );
  });

  it('should notify creator when assignee starts working', async () => {
    const mockAgent = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    const mockGetAgent = vi.fn().mockReturnValue(mockAgent);

    const taskEvent = {
      type: 'task:updated' as const,
      task: {
        id: 'task_progress',
        title: 'Work Starting',
        status: 'in_progress' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Do this work',
        priority: 'medium' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      },
      previousTask: {
        id: 'task_progress',
        title: 'Work Starting',
        status: 'pending' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Do this work',
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

    // Verify creator was notified about progress
    expect(mockGetAgent).toHaveBeenCalledWith(creatorAgent);
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('in_progress'),
      expect.objectContaining({
        queue: true,
        metadata: expect.objectContaining({
          source: 'task_system',
          priority: 'high',
        }),
      })
    );
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Work Starting'),
      expect.any(Object)
    );
  });

  it('should notify creator when task becomes blocked', async () => {
    const mockAgent = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    const mockGetAgent = vi.fn().mockReturnValue(mockAgent);

    const taskEvent = {
      type: 'task:updated' as const,
      task: {
        id: 'task_blocked',
        title: 'Blocked Task',
        status: 'blocked' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Cannot proceed',
        priority: 'high' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      },
      previousTask: {
        id: 'task_blocked',
        title: 'Blocked Task',
        status: 'in_progress' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Cannot proceed',
        priority: 'high' as const,
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

    // Verify creator was notified about blockage
    expect(mockGetAgent).toHaveBeenCalledWith(creatorAgent);
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('blocked'),
      expect.objectContaining({
        queue: true,
        metadata: expect.objectContaining({
          source: 'task_system',
          priority: 'high',
        }),
      })
    );
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Blocked Task'),
      expect.any(Object)
    );
  });

  it('should not notify creator when they complete their own task', async () => {
    const mockAgent = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    const mockGetAgent = vi.fn().mockReturnValue(mockAgent);

    const taskEvent = {
      type: 'task:updated' as const,
      task: {
        id: 'task_self',
        title: 'Self Completed',
        status: 'completed' as const,
        createdBy: creatorAgent,
        assignedTo: creatorAgent,
        prompt: 'Do it myself',
        priority: 'low' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      },
      previousTask: {
        id: 'task_self',
        title: 'Self Completed',
        status: 'in_progress' as const,
        createdBy: creatorAgent,
        assignedTo: creatorAgent,
        prompt: 'Do it myself',
        priority: 'low' as const,
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

    // Should not notify creator since they are the actor
    expect(mockGetAgent).not.toHaveBeenCalled();
    expect(mockAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('should handle missing agents gracefully', async () => {
    const mockGetAgent = vi.fn().mockReturnValue(null);

    const taskEvent = {
      type: 'task:updated' as const,
      task: {
        id: 'task_noagent',
        title: 'No Agent',
        status: 'completed' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Work',
        priority: 'medium' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      },
      previousTask: {
        id: 'task_noagent',
        title: 'No Agent',
        status: 'in_progress' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Work',
        priority: 'medium' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      },
      context: { actor: assigneeAgent },
      timestamp: new Date(),
    };

    // Should not throw even when agent is missing
    await expect(
      routeTaskNotifications(taskEvent, {
        getAgent: mockGetAgent,
        sessionId,
      })
    ).resolves.toBeUndefined();

    expect(mockGetAgent).toHaveBeenCalledWith(creatorAgent);
  });

  it('should not notify for trivial status changes', async () => {
    const mockAgent = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    const mockGetAgent = vi.fn().mockReturnValue(mockAgent);

    const taskEvent = {
      type: 'task:updated' as const,
      task: {
        id: 'task_trivial',
        title: 'No Change',
        status: 'pending' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Work',
        priority: 'medium' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      },
      previousTask: {
        id: 'task_trivial',
        title: 'No Change',
        status: 'pending' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Work',
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

    // Should not notify when status doesn't actually change
    expect(mockGetAgent).not.toHaveBeenCalled();
    expect(mockAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('should not notify assignee when they are the actor', async () => {
    const mockAgent = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    const mockGetAgent = vi.fn().mockReturnValue(mockAgent);

    const taskEvent = {
      type: 'task:created' as const,
      task: {
        id: 'task_self_assign',
        title: 'Self Assignment',
        status: 'pending' as const,
        createdBy: assigneeAgent,
        assignedTo: assigneeAgent,
        prompt: 'Work on this myself',
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

    // Should not notify assignee when they created and assigned to themselves
    expect(mockGetAgent).not.toHaveBeenCalled();
    expect(mockAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('should notify creator when significant note is added by assignee', async () => {
    const mockAgent = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    const mockGetAgent = vi.fn().mockReturnValue(mockAgent);

    const taskEvent = {
      type: 'task:note_added' as const,
      task: {
        id: 'task_with_note',
        title: 'Task With Progress Update',
        status: 'in_progress' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Complete this work',
        priority: 'high' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [
          {
            id: 'note_123',
            author: assigneeAgent,
            content:
              'I have completed the initial analysis and found several issues that need to be addressed',
            timestamp: new Date(),
          },
        ],
      },
      context: { actor: assigneeAgent },
      timestamp: new Date(),
    };

    await routeTaskNotifications(taskEvent, {
      getAgent: mockGetAgent,
      sessionId,
    });

    // Verify creator was notified about the note
    expect(mockGetAgent).toHaveBeenCalledWith(creatorAgent);
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('New note added'),
      expect.objectContaining({
        queue: true,
        metadata: expect.objectContaining({
          source: 'task_system',
          priority: 'normal',
        }),
      })
    );
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('completed the initial analysis'),
      expect.any(Object)
    );
  });

  it('should notify creator for all notes from other agents (including short ones)', async () => {
    const mockAgent = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    const mockGetAgent = vi.fn().mockReturnValue(mockAgent);

    const taskEvent = {
      type: 'task:note_added' as const,
      task: {
        id: 'task_short_note',
        title: 'Task With Short Note',
        status: 'in_progress' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Do work',
        priority: 'medium' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [
          {
            id: 'note_short',
            author: assigneeAgent,
            content: 'Started working on this',
            timestamp: new Date(),
          },
        ],
      },
      context: { actor: assigneeAgent },
      timestamp: new Date(),
    };

    await routeTaskNotifications(taskEvent, {
      getAgent: mockGetAgent,
      sessionId,
    });

    // Should notify for ALL notes from other agents, regardless of length
    expect(mockGetAgent).toHaveBeenCalledWith(creatorAgent);
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('New note added'),
      expect.objectContaining({
        queue: true,
        metadata: expect.objectContaining({
          source: 'task_system',
          priority: 'normal',
        }),
      })
    );
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Started working on this'),
      expect.any(Object)
    );
  });

  it('should not notify creator when they add their own note', async () => {
    const mockAgent = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    const mockGetAgent = vi.fn().mockReturnValue(mockAgent);

    const taskEvent = {
      type: 'task:note_added' as const,
      task: {
        id: 'task_self_note',
        title: 'Task With Creator Note',
        status: 'in_progress' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Important task',
        priority: 'high' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [
          {
            id: 'note_creator',
            author: creatorAgent,
            content:
              'I am adding this important note about the requirements that need to be considered',
            timestamp: new Date(),
          },
        ],
      },
      context: { actor: creatorAgent },
      timestamp: new Date(),
    };

    await routeTaskNotifications(taskEvent, {
      getAgent: mockGetAgent,
      sessionId,
    });

    // Should not notify creator about their own notes
    expect(mockGetAgent).not.toHaveBeenCalled();
    expect(mockAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('should not notify old assignee when they initiated the reassignment', async () => {
    const oldAssignee = asThreadId('lace_20250922_test01.3');
    const mockNewAgent = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    const mockOldAgent = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    const mockGetAgent = vi.fn().mockImplementation((id) => {
      if (id === assigneeAgent) return mockNewAgent;
      if (id === oldAssignee) return mockOldAgent;
      return null;
    });

    const taskEvent = {
      type: 'task:updated' as const,
      task: {
        id: 'task_self_reassign',
        title: 'Self Reassigned Task',
        status: 'in_progress' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Work to transfer',
        priority: 'medium' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      },
      previousTask: {
        id: 'task_self_reassign',
        title: 'Self Reassigned Task',
        status: 'in_progress' as const,
        createdBy: creatorAgent,
        assignedTo: oldAssignee,
        prompt: 'Work to transfer',
        priority: 'medium' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      },
      context: { actor: oldAssignee },
      timestamp: new Date(),
    };

    await routeTaskNotifications(taskEvent, {
      getAgent: mockGetAgent,
      sessionId,
    });

    // New assignee should be notified
    expect(mockGetAgent).toHaveBeenCalledWith(assigneeAgent);
    expect(mockNewAgent.sendMessage).toHaveBeenCalled();

    // Old assignee should NOT be notified when they initiated the reassignment
    expect(mockOldAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('should handle sendMessage errors gracefully', async () => {
    const mockAgent = {
      sendMessage: vi.fn().mockRejectedValue(new Error('Network error')),
    };
    const mockGetAgent = vi.fn().mockReturnValue(mockAgent);

    const taskEvent = {
      type: 'task:updated' as const,
      task: {
        id: 'task_error',
        title: 'Error Task',
        status: 'completed' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Work',
        priority: 'medium' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      },
      previousTask: {
        id: 'task_error',
        title: 'Error Task',
        status: 'in_progress' as const,
        createdBy: creatorAgent,
        assignedTo: assigneeAgent,
        prompt: 'Work',
        priority: 'medium' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      },
      context: { actor: assigneeAgent },
      timestamp: new Date(),
    };

    // Should not throw even when sendMessage fails
    await expect(
      routeTaskNotifications(taskEvent, {
        getAgent: mockGetAgent,
        sessionId,
      })
    ).resolves.toBeUndefined();

    expect(mockAgent.sendMessage).toHaveBeenCalled();
  });
});
