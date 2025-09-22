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

// Re-export core types this utility needs
export type { Task, TaskNote, TaskContext } from '~/tasks/types';
export type { ThreadId } from '~/threads/types';
