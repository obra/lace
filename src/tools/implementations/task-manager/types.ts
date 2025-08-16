// ABOUTME: Type definitions for enhanced task management with multi-agent support
// ABOUTME: Defines Task, TaskNote interfaces with thread-based assignment capabilities

import { ThreadId, AssigneeId } from '~/threads/types';
import type { TaskStatus } from '~/tasks/task-status';

export type { TaskStatus };
export type TaskPriority = 'high' | 'medium' | 'low';

// Task actors can be either a ThreadId or 'human' (or any string that represents a valid thread ID)
export type TaskActor = string;

export interface Task {
  id: string;
  title: string; // Brief summary
  description: string; // Human-readable details
  prompt: string; // Detailed instructions for assigned agent
  status: TaskStatus;
  priority: TaskPriority;
  assignedTo?: AssigneeId; // ThreadId or NewAgentSpec
  createdBy: TaskActor; // ThreadId of creating agent or 'human'
  threadId: ThreadId; // Parent thread ID only (e.g., "lace_20250703_abc123")
  createdAt: Date;
  updatedAt: Date;
  notes: TaskNote[];
}

export interface TaskNote {
  id: string;
  author: TaskActor; // ThreadId of note author or 'human'
  content: string;
  timestamp: Date;
}
