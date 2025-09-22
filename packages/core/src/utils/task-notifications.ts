// ABOUTME: Type definitions for task notification routing system
// ABOUTME: Defines interfaces and types used by notification utilities

import type { ThreadId } from '~/threads/types';
import type { Task, TaskNote, TaskContext } from '~/tasks/types';
import type { Agent } from '~/agents/agent';

export interface TaskNotification {
  threadId: ThreadId;
  message: string;
  notificationType: 'completion' | 'assignment' | 'status_change' | 'note_added';
  taskId: string;
  priority: 'immediate' | 'background';
}

export interface TaskNotificationContext {
  getAgent: (threadId: ThreadId) => Agent | null;
  sessionId: ThreadId;
}

export type NotificationTarget =
  | 'creator' // Always notify task creator
  | 'assignee' // Always notify current assignee
  | 'old_assignee' // Notify previous assignee (reassignments)
  | 'creator_unless_actor' // Notify creator if they didn't cause the update
  | 'assignee_unless_actor' // Notify assignee if they didn't cause the update
  | 'creator_unless_author'; // Notify creator if they didn't author the change

export async function routeTaskNotifications(
  event: TaskManagerEvent,
  context: TaskNotificationContext
): Promise<void> {
  // Handle task creation with assignment
  if (event.type === 'task:created') {
    const { task, context: taskContext } = event;

    if (task.assignedTo && task.assignedTo !== taskContext.actor) {
      const assigneeAgent = context.getAgent(task.assignedTo);
      if (assigneeAgent) {
        const message = `[LACE TASK SYSTEM] You have been assigned task '${task.id}':
Title: "${task.title}"
Created by: ${task.createdBy}
Priority: ${task.priority}

--- TASK DETAILS ---
${task.prompt}
--- END TASK DETAILS ---

Use your task_add_note tool to record progress and task_complete when done.`;

        await assigneeAgent.sendMessage(message);
      }
    }
    return;
  }

  // Handle task updates - but we can't detect what changed without previousTask
  if (event.type === 'task:updated') {
    const { task, context: taskContext } = event;

    // For now, just notify on completion status (we'll fix this in Phase 2)
    if (task.status === 'completed' && task.createdBy !== taskContext.actor) {
      const creatorAgent = context.getAgent(task.createdBy);
      if (creatorAgent) {
        const message = `Task '${task.id}' that you created has been completed by ${taskContext.actor}:
Title: "${task.title}"
Status: completed ✅

You can now review the results or create follow-up tasks.`;

        await creatorAgent.sendMessage(message);
      }
    }
  }
}

// Type for TaskManager events - matches what TaskManager actually emits
export interface TaskManagerEvent {
  type: 'task:updated' | 'task:created' | 'task:note_added';
  task: Task;
  context: TaskContext;
  timestamp: Date;
  // Note: no previousTask - TaskManager doesn't provide this
}

// Re-export core types this utility needs
export type { Task, TaskNote, TaskContext } from '~/tasks/types';
export type { ThreadId } from '~/threads/types';
