// ABOUTME: Task notification routing system for notifying agents about task updates
// ABOUTME: Handles completion, assignment, status change, and note notifications

import type { ThreadId } from '~/threads/types';
import { isNewAgentSpec } from '~/threads/types';
import type { Task, TaskContext, TaskNote } from '~/tasks/types';
import type { Agent } from '~/agents/agent';
import { logger } from '~/utils/logger';

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

Use your task_add_note tool to record progress and task_complete tool when you are done.`;
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

// Analysis functions to determine who should be notified
function analyzeTaskEventForNotifications(
  event: TaskManagerEvent,
  previousTask?: Task
): TaskNotification[] {
  switch (event.type) {
    case 'task:created':
      return analyzeTaskCreation(event.task, event.context);
    case 'task:updated':
      return analyzeTaskUpdate(event.task, previousTask, event.context);
    case 'task:note_added':
      return analyzeNoteAdded(event.task, event.context);
    default:
      return [];
  }
}

function analyzeTaskCreation(task: Task, context: TaskContext): TaskNotification[] {
  const notifications: TaskNotification[] = [];

  // Notify assignee if they didn't create the task (only if it's an actual agent, not a NewAgentSpec)
  if (task.assignedTo && task.assignedTo !== context.actor && !isNewAgentSpec(task.assignedTo)) {
    notifications.push({
      threadId: task.assignedTo as ThreadId,
      message: formatTaskAssignment(task),
      notificationType: 'assignment',
      taskId: task.id,
      priority: 'immediate',
    });
  }

  return notifications;
}

function analyzeTaskUpdate(
  task: Task,
  previousTask: Task | undefined,
  context: TaskContext
): TaskNotification[] {
  const notifications: TaskNotification[] = [];

  if (!previousTask) {
    return notifications;
  }

  const statusChanged = previousTask.status !== task.status;
  const assigneeChanged = previousTask.assignedTo !== task.assignedTo;

  // Completion notification
  if (statusChanged && task.status === 'completed' && task.createdBy !== context.actor) {
    notifications.push({
      threadId: task.createdBy as ThreadId,
      message: formatCompletionNotification(task, context.actor as ThreadId),
      notificationType: 'completion',
      taskId: task.id,
      priority: 'immediate',
    });
  }

  // Status change notifications (in_progress, blocked)
  if (statusChanged && task.createdBy !== context.actor) {
    if (previousTask.status === 'pending' && task.status === 'in_progress') {
      notifications.push({
        threadId: task.createdBy as ThreadId,
        message: formatStatusChangeNotification(task, 'in_progress', context.actor as ThreadId),
        notificationType: 'status_change',
        taskId: task.id,
        priority: 'immediate',
      });
    } else if (task.status === 'blocked') {
      notifications.push({
        threadId: task.createdBy as ThreadId,
        message: formatStatusChangeNotification(task, 'blocked', context.actor as ThreadId),
        notificationType: 'status_change',
        taskId: task.id,
        priority: 'immediate',
      });
    }
  }

  // Reassignment notifications
  if (assigneeChanged) {
    // Notify new assignee if they didn't cause the change (only if it's an actual agent, not a NewAgentSpec)
    if (task.assignedTo && task.assignedTo !== context.actor && !isNewAgentSpec(task.assignedTo)) {
      notifications.push({
        threadId: task.assignedTo as ThreadId,
        message: formatTaskAssignment(task),
        notificationType: 'assignment',
        taskId: task.id,
        priority: 'immediate',
      });
    }

    // Notify old assignee about reassignment (only if it's an actual agent, not a NewAgentSpec)
    if (
      previousTask.assignedTo &&
      previousTask.assignedTo !== context.actor &&
      !isNewAgentSpec(previousTask.assignedTo)
    ) {
      notifications.push({
        threadId: previousTask.assignedTo as ThreadId,
        message: formatReassignmentNotification(task, previousTask.assignedTo as ThreadId),
        notificationType: 'assignment',
        taskId: task.id,
        priority: 'background',
      });
    }
  }

  return notifications;
}

function analyzeNoteAdded(task: Task, context: TaskContext): TaskNotification[] {
  const notifications: TaskNotification[] = [];

  // Get the most recent note (assuming it's the one just added)
  const latestNote = task.notes && task.notes.length > 0 ? task.notes[task.notes.length - 1] : null;

  if (!latestNote) {
    return notifications;
  }

  // Notify for all notes from other agents (no minimum length)

  // Don't notify creator if they added the note
  if (task.createdBy === context.actor) {
    return notifications;
  }

  notifications.push({
    threadId: task.createdBy as ThreadId,
    message: formatNoteNotification(task, latestNote, context.actor as ThreadId),
    notificationType: 'note_added',
    taskId: task.id,
    priority: 'background',
  });

  return notifications;
}

// Additional formatting functions
function formatReassignmentNotification(task: Task, _oldAssignee: ThreadId): string {
  return `Task '${task.id}' has been reassigned:
Title: "${task.title}"
New assignee: ${task.assignedTo || 'unassigned'}

You are no longer responsible for this task.`;
}

function formatNoteNotification(task: Task, note: TaskNote, author: ThreadId): string {
  return `New note added to task '${task.id}' by ${author}:
Title: "${task.title}"

--- NOTE ---
${note.content}
--- END NOTE ---

Review the progress update above.`;
}

export async function routeTaskNotifications(
  event: TaskManagerEvent,
  context: TaskNotificationContext
): Promise<void> {
  // Analyze event to determine notifications
  const notifications = analyzeTaskEventForNotifications(
    event,
    event.type === 'task:updated' ? event.previousTask : undefined
  );

  // Send all notifications as user messages - LLM will handle not getting stuck in loops
  for (const notification of notifications) {
    const agent = context.getAgent(notification.threadId);
    if (agent) {
      try {
        // Send notification as user message with proper metadata
        await agent.sendMessage(notification.message, {
          queue: true,
          metadata: {
            source: 'task_system',
            priority: notification.priority === 'immediate' ? 'high' : 'normal',
          },
        });
      } catch (error) {
        logger.error('Failed to send task notification', {
          threadId: notification.threadId,
          taskId: notification.taskId,
          notificationType: notification.notificationType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      logger.warn('Agent not found for task notification', {
        threadId: notification.threadId,
        taskId: notification.taskId,
        notificationType: notification.notificationType,
        sessionId: context.sessionId,
      });
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
