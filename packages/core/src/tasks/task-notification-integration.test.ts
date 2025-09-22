// ABOUTME: Integration tests for task notification system
// ABOUTME: Tests end-to-end notification delivery from TaskManager through Session to Agents

import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { routeTaskNotifications } from '~/utils/task-notifications';
import type { TaskManagerEvent, TaskNotificationContext } from '~/utils/task-notifications';
import { asThreadId } from '~/threads/types';
import type { ThreadId } from '~/threads/types';
import type { Task, TaskContext } from '~/tasks/types';
import type { Agent } from '~/agents/agent';

describe('Task Notification Integration', () => {
  let mockGetAgent: MockedFunction<(threadId: ThreadId) => Agent | null>;
  let sessionId: ThreadId;
  let creatorThreadId: ThreadId;
  let assigneeThreadId: ThreadId;

  // Mock agents to capture messages
  let creatorAgent: { sendMessage: MockedFunction<(message: string) => Promise<void>> };
  let assigneeAgent: { sendMessage: MockedFunction<(message: string) => Promise<void>> };

  // Track messages
  const creatorMessages: string[] = [];
  const assigneeMessages: string[] = [];

  beforeEach(() => {
    sessionId = asThreadId('lace_20250922_sess01');
    creatorThreadId = asThreadId('lace_20250922_creat1');
    assigneeThreadId = asThreadId('lace_20250922_assgn1');

    // Create mock agents
    creatorAgent = {
      sendMessage: vi.fn(async (message: string) => {
        creatorMessages.push(message);
      }),
    };

    assigneeAgent = {
      sendMessage: vi.fn(async (message: string) => {
        assigneeMessages.push(message);
      }),
    };

    // Setup mock getAgent function
    mockGetAgent = vi.fn((threadId: ThreadId) => {
      if (threadId === creatorThreadId) {
        return creatorAgent as unknown as Agent;
      } else if (threadId === assigneeThreadId) {
        return assigneeAgent as unknown as Agent;
      }
      return null;
    });

    // Clear message arrays
    creatorMessages.length = 0;
    assigneeMessages.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should deliver completion notification through notification system', async () => {
    const task: Task = {
      id: 'task_20250922_abc123',
      title: 'Test Task',
      description: 'Test description',
      prompt: 'Complete this test',
      status: 'completed',
      priority: 'medium',
      createdBy: creatorThreadId,
      assignedTo: assigneeThreadId,
      threadId: sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
    };

    const previousTask: Task = {
      ...task,
      status: 'in_progress',
    };

    const event: TaskManagerEvent = {
      type: 'task:updated',
      task,
      previousTask,
      context: { actor: assigneeThreadId, isHuman: false },
      timestamp: new Date(),
    };

    const context: TaskNotificationContext = {
      getAgent: mockGetAgent,
      sessionId,
    };

    // Process the notification
    await routeTaskNotifications(event, context);

    // Verify creator was notified about completion
    expect(mockGetAgent).toHaveBeenCalledWith(creatorThreadId);
    expect(creatorAgent.sendMessage).toHaveBeenCalledOnce();
    expect(creatorMessages[0]).toContain('completed');
    expect(creatorMessages[0]).toContain('task_20250922_abc123');
    expect(creatorMessages[0]).toContain('Test Task');
    expect(creatorMessages[0]).toContain('✅');

    // Verify assignee was NOT notified
    expect(assigneeAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('should notify assignee when task is created with assignment', async () => {
    const task: Task = {
      id: 'task_20250922_def456',
      title: 'Assigned Task',
      description: 'Task with assignment',
      prompt: 'Work on this assigned task',
      status: 'pending',
      priority: 'high',
      createdBy: creatorThreadId,
      assignedTo: assigneeThreadId,
      threadId: sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
    };

    const event: TaskManagerEvent = {
      type: 'task:created',
      task,
      context: { actor: creatorThreadId, isHuman: false },
      timestamp: new Date(),
    };

    const context: TaskNotificationContext = {
      getAgent: mockGetAgent,
      sessionId,
    };

    // Process the notification
    await routeTaskNotifications(event, context);

    // Verify assignee was notified
    expect(mockGetAgent).toHaveBeenCalledWith(assigneeThreadId);
    expect(assigneeAgent.sendMessage).toHaveBeenCalledOnce();
    expect(assigneeMessages[0]).toContain('[LACE TASK SYSTEM]');
    expect(assigneeMessages[0]).toContain('You have been assigned');
    expect(assigneeMessages[0]).toContain('task_20250922_def456');
    expect(assigneeMessages[0]).toContain('Assigned Task');
    expect(assigneeMessages[0]).toContain('high');

    // Verify creator was NOT notified
    expect(creatorAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('should notify both old and new assignee when task is reassigned', async () => {
    const newAssigneeThreadId = asThreadId('lace_20250922_newas1');
    const newAssigneeMessages: string[] = [];
    const newAssigneeAgent = {
      sendMessage: vi.fn(async (message: string) => {
        newAssigneeMessages.push(message);
      }),
    };

    // Update mock to include new assignee
    mockGetAgent.mockImplementation((threadId: ThreadId) => {
      if (threadId === creatorThreadId) {
        return creatorAgent as unknown as Agent;
      } else if (threadId === assigneeThreadId) {
        return assigneeAgent as unknown as Agent;
      } else if (threadId === newAssigneeThreadId) {
        return newAssigneeAgent as unknown as Agent;
      }
      return null;
    });

    const task: Task = {
      id: 'task_20250922_ghi789',
      title: 'Reassigned Task',
      description: 'Task being reassigned',
      prompt: 'This task will be reassigned',
      status: 'pending',
      priority: 'low',
      createdBy: creatorThreadId,
      assignedTo: newAssigneeThreadId,
      threadId: sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
    };

    const previousTask: Task = {
      ...task,
      assignedTo: assigneeThreadId,
    };

    const event: TaskManagerEvent = {
      type: 'task:updated',
      task,
      previousTask,
      context: { actor: creatorThreadId, isHuman: true },
      timestamp: new Date(),
    };

    const context: TaskNotificationContext = {
      getAgent: mockGetAgent,
      sessionId,
    };

    // Process the notification
    await routeTaskNotifications(event, context);

    // Verify new assignee was notified
    expect(mockGetAgent).toHaveBeenCalledWith(newAssigneeThreadId);
    expect(newAssigneeAgent.sendMessage).toHaveBeenCalledOnce();
    expect(newAssigneeMessages[0]).toContain('[LACE TASK SYSTEM]');
    expect(newAssigneeMessages[0]).toContain('You have been assigned');

    // Verify old assignee was notified about reassignment
    expect(mockGetAgent).toHaveBeenCalledWith(assigneeThreadId);
    expect(assigneeAgent.sendMessage).toHaveBeenCalledOnce();
    expect(assigneeMessages[0]).toContain('reassigned');
    expect(assigneeMessages[0]).toContain('no longer responsible');

    // Verify creator was NOT notified
    expect(creatorAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('should notify creator when task becomes blocked', async () => {
    const task: Task = {
      id: 'task_20250922_jkl012',
      title: 'Blocked Task',
      description: 'Task that becomes blocked',
      prompt: 'Task encountering issues',
      status: 'blocked',
      priority: 'medium',
      createdBy: creatorThreadId,
      assignedTo: assigneeThreadId,
      threadId: sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
    };

    const previousTask: Task = {
      ...task,
      status: 'in_progress',
    };

    const event: TaskManagerEvent = {
      type: 'task:updated',
      task,
      previousTask,
      context: { actor: assigneeThreadId, isHuman: false },
      timestamp: new Date(),
    };

    const context: TaskNotificationContext = {
      getAgent: mockGetAgent,
      sessionId,
    };

    // Process the notification
    await routeTaskNotifications(event, context);

    // Verify creator was notified
    expect(mockGetAgent).toHaveBeenCalledWith(creatorThreadId);
    expect(creatorAgent.sendMessage).toHaveBeenCalledOnce();
    expect(creatorMessages[0]).toContain('blocked');
    expect(creatorMessages[0]).toContain('⛔');
    expect(creatorMessages[0]).toContain('encountered an issue');

    // Verify assignee was NOT notified
    expect(assigneeAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('should notify creator when assignee starts working on task', async () => {
    const task: Task = {
      id: 'task_20250922_mno345',
      title: 'In Progress Task',
      description: 'Task starting work',
      prompt: 'Begin work on this',
      status: 'in_progress',
      priority: 'high',
      createdBy: creatorThreadId,
      assignedTo: assigneeThreadId,
      threadId: sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
    };

    const previousTask: Task = {
      ...task,
      status: 'pending',
    };

    const event: TaskManagerEvent = {
      type: 'task:updated',
      task,
      previousTask,
      context: { actor: assigneeThreadId, isHuman: false },
      timestamp: new Date(),
    };

    const context: TaskNotificationContext = {
      getAgent: mockGetAgent,
      sessionId,
    };

    // Process the notification
    await routeTaskNotifications(event, context);

    // Verify creator was notified
    expect(mockGetAgent).toHaveBeenCalledWith(creatorThreadId);
    expect(creatorAgent.sendMessage).toHaveBeenCalledOnce();
    expect(creatorMessages[0]).toContain('in_progress');
    expect(creatorMessages[0]).toContain('🔄');
    expect(creatorMessages[0]).toContain('started working');
  });

  it('should notify creator when significant note is added', async () => {
    const significantNote =
      'This is a detailed progress update with important information about the implementation approach and challenges encountered';

    const task: Task = {
      id: 'task_20250922_pqr678',
      title: 'Task with Notes',
      description: 'Task receiving notes',
      prompt: 'Add notes to this task',
      status: 'in_progress',
      priority: 'medium',
      createdBy: creatorThreadId,
      assignedTo: assigneeThreadId,
      threadId: sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [
        {
          id: 'note_1',
          author: assigneeThreadId,
          content: significantNote,
          timestamp: new Date(),
        },
      ],
    };

    const event: TaskManagerEvent = {
      type: 'task:note_added',
      task,
      context: { actor: assigneeThreadId, isHuman: false },
      timestamp: new Date(),
    };

    const context: TaskNotificationContext = {
      getAgent: mockGetAgent,
      sessionId,
    };

    // Process the notification
    await routeTaskNotifications(event, context);

    // Verify creator was notified
    expect(mockGetAgent).toHaveBeenCalledWith(creatorThreadId);
    expect(creatorAgent.sendMessage).toHaveBeenCalledOnce();
    expect(creatorMessages[0]).toContain('New note added');
    expect(creatorMessages[0]).toContain('task_20250922_pqr678');
    expect(creatorMessages[0]).toContain(significantNote);
  });

  it('should not notify creator for trivial notes', async () => {
    const trivialNote = 'Started working';

    const task: Task = {
      id: 'task_20250922_stu901',
      title: 'Task with Trivial Note',
      description: 'Task with short note',
      prompt: 'Add short note',
      status: 'in_progress',
      priority: 'low',
      createdBy: creatorThreadId,
      assignedTo: assigneeThreadId,
      threadId: sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [
        {
          id: 'note_2',
          author: assigneeThreadId,
          content: trivialNote,
          timestamp: new Date(),
        },
      ],
    };

    const event: TaskManagerEvent = {
      type: 'task:note_added',
      task,
      context: { actor: assigneeThreadId, isHuman: false },
      timestamp: new Date(),
    };

    const context: TaskNotificationContext = {
      getAgent: mockGetAgent,
      sessionId,
    };

    // Process the notification
    await routeTaskNotifications(event, context);

    // Verify creator was NOT notified for trivial note
    expect(creatorAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('should not notify creator when they complete their own task', async () => {
    const task: Task = {
      id: 'task_20250922_vwx234',
      title: 'Self-Completed Task',
      description: 'Creator completes own task',
      prompt: 'Complete this yourself',
      status: 'completed',
      priority: 'medium',
      createdBy: creatorThreadId,
      assignedTo: creatorThreadId,
      threadId: sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
    };

    const previousTask: Task = {
      ...task,
      status: 'in_progress',
    };

    const event: TaskManagerEvent = {
      type: 'task:updated',
      task,
      previousTask,
      context: { actor: creatorThreadId, isHuman: false },
      timestamp: new Date(),
    };

    const context: TaskNotificationContext = {
      getAgent: mockGetAgent,
      sessionId,
    };

    // Process the notification
    await routeTaskNotifications(event, context);

    // Verify creator was NOT notified about their own completion
    expect(creatorAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('should handle missing agents gracefully', async () => {
    const phantomThreadId = asThreadId('lace_20250922_phant1');

    const task: Task = {
      id: 'task_20250922_yz567',
      title: 'Phantom Task',
      description: 'Task with missing agent',
      prompt: 'Test missing agent',
      status: 'completed',
      priority: 'low',
      createdBy: phantomThreadId,
      assignedTo: assigneeThreadId,
      threadId: sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
    };

    const previousTask: Task = {
      ...task,
      status: 'pending',
    };

    const event: TaskManagerEvent = {
      type: 'task:updated',
      task,
      previousTask,
      context: { actor: assigneeThreadId, isHuman: false },
      timestamp: new Date(),
    };

    const context: TaskNotificationContext = {
      getAgent: mockGetAgent,
      sessionId,
    };

    // Should not throw even though phantom agent doesn't exist
    await expect(routeTaskNotifications(event, context)).resolves.not.toThrow();

    // Verify getAgent was called for phantom thread
    expect(mockGetAgent).toHaveBeenCalledWith(phantomThreadId);

    // Verify assignee wasn't notified (since they completed it)
    expect(assigneeAgent.sendMessage).not.toHaveBeenCalled();
  });
});
