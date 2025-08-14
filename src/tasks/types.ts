// ABOUTME: Type definitions for the task management system
// ABOUTME: Used by both agent tools and human-facing web APIs

// Re-export the existing types for compatibility
export type {
  Task,
  TaskNote,
  TaskStatus,
  TaskPriority,
} from '~/tools/implementations/task-manager/types';

import type { TaskActor } from '~/tools/implementations/task-manager/types';

export interface TaskContext {
  actor: TaskActor; // Who is performing the action (ThreadId or 'human')
  isHuman?: boolean; // Quick check for human vs agent
}

export interface CreateTaskRequest {
  title: string;
  description?: string;
  prompt: string;
  priority?: 'high' | 'medium' | 'low';
  assignedTo?: string;
}

export interface TaskFilters {
  status?: 'pending' | 'in_progress' | 'completed' | 'blocked';
  priority?: 'high' | 'medium' | 'low';
  assignedTo?: string;
  createdBy?: string;
}

export interface TaskSummary {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  blocked: number;
}
