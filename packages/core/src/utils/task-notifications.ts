// ABOUTME: Type definitions for task notification routing system
// ABOUTME: Defines interfaces and types used by notification utilities

import type { ThreadId } from '~/threads/types';
import type { Task, TaskContext } from '~/tasks/types';
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

// Message formatting functions
function formatCompletionNotification(task: Task, completedBy: ThreadId): string {
  return `Task '${task.id}' that you created has been completed by ${completedBy}:
Title: "${task.title}"
Status: completed ✅

You can now review the results or create follow-up tasks.`;
}

function formatTaskAssignment(task: Task): string {
  return `[LACE TASK SYSTEM] You have been assigned task '${task.id}':
Title: "${task.title}"
Created by: ${task.createdBy}
Priority: ${task.priority}
Status: ${task.status}

--- TASK DETAILS ---
${task.prompt}
--- END TASK DETAILS ---

Use your task_add_note tool to record progress and task_complete when done.`;
}

function formatStatusChangeNotification(
  task: Task,
  newStatus: string,
  changedBy: ThreadId
): string {
  const statusEmoji = getStatusEmoji(newStatus);
  const statusDescription = getStatusDescription(newStatus);

  return `Task '${task.id}' that you created is now ${newStatus}${statusEmoji ? ' ' + statusEmoji : ''}:
Title: "${task.title}"
Changed by: ${changedBy}

${statusDescription}`;
}

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'completed':
      return '✅';
    case 'blocked':
      return '⛔';
    case 'in_progress':
      return '🔄';
    default:
      return '';
  }
}

function getStatusDescription(status: string): string {
  switch (status) {
    case 'in_progress':
      return 'The assignee has started working on your task.';
    case 'blocked':
      return 'The assignee has encountered an issue that prevents progress.';
    case 'completed':
      return 'You can now review the results or create follow-up tasks.';
    default:
      return '';
  }
}

export async function routeTaskNotifications(
  event: TaskManagerEvent,
  context: TaskNotificationContext
): Promise<void> {
  // Handle task creation with assignment
  if (event.type === 'task:created') {
    const { task, context: taskContext } = event;

    if (task.assignedTo && task.assignedTo !== taskContext.actor) {
      const assigneeAgent = context.getAgent(task.assignedTo as ThreadId);
      if (assigneeAgent) {
        const message = formatTaskAssignment({ ...task, status: task.status || 'pending' } as Task);
        await assigneeAgent.sendMessage(message);
      }
    }
    return;
  }

  // Handle task updates with proper change detection
  if (event.type === 'task:updated') {
    const { task, previousTask, context: taskContext } = event;

    // Skip if there's no previous task (can't detect changes)
    if (!previousTask) {
      return;
    }

    // Check if status actually changed
    const statusChanged = previousTask.status !== task.status;

    // Detect completion (status changed to completed)
    if (statusChanged && task.status === 'completed' && task.createdBy !== taskContext.actor) {
      const creatorAgent = context.getAgent(task.createdBy as ThreadId);
      if (creatorAgent) {
        const message = formatCompletionNotification(task, taskContext.actor as ThreadId);
        await creatorAgent.sendMessage(message);
      }
    }

    // Detect start of work (pending → in_progress)
    if (
      statusChanged &&
      previousTask.status === 'pending' &&
      task.status === 'in_progress' &&
      task.createdBy !== taskContext.actor
    ) {
      const creatorAgent = context.getAgent(task.createdBy as ThreadId);
      if (creatorAgent) {
        const message = formatStatusChangeNotification(
          task,
          'in_progress',
          taskContext.actor as ThreadId
        );
        await creatorAgent.sendMessage(message);
      }
    }

    // Detect blocked status
    if (statusChanged && task.status === 'blocked' && task.createdBy !== taskContext.actor) {
      const creatorAgent = context.getAgent(task.createdBy as ThreadId);
      if (creatorAgent) {
        const message = formatStatusChangeNotification(
          task,
          'blocked',
          taskContext.actor as ThreadId
        );
        await creatorAgent.sendMessage(message);
      }
    }

    // Detect reassignment (assignedTo changed)
    if (
      previousTask.assignedTo !== task.assignedTo &&
      task.assignedTo &&
      task.assignedTo !== taskContext.actor
    ) {
      const newAssigneeAgent = context.getAgent(task.assignedTo as ThreadId);
      if (newAssigneeAgent) {
        const message = formatTaskAssignment(task);
        await newAssigneeAgent.sendMessage(message);
      }
    }
  }
}

// Type for TaskManager events - matches what TaskManager actually emits
export interface TaskManagerEvent {
  type: 'task:updated' | 'task:created' | 'task:note_added';
  task: Task;
  previousTask?: Task; // Only present for task:updated events
  context: TaskContext;
  timestamp: Date;
}

// Re-export core types this utility needs
export type { Task, TaskNote, TaskContext } from '~/tasks/types';
export type { ThreadId } from '~/threads/types';
