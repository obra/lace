// ABOUTME: Type definitions for enhanced task management with multi-agent support
// ABOUTME: Defines Task, TaskNote interfaces with thread-based assignment capabilities

import { ThreadId, AssigneeId } from '~/threads/types';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';
export type TaskPriority = 'high' | 'medium' | 'low';

export interface Task {
  id: string;
  title: string; // Brief summary
  description: string; // Human-readable details
  prompt: string; // Detailed instructions for assigned agent
  status: TaskStatus;
  priority: TaskPriority;
  assignedTo?: AssigneeId; // ThreadId or NewAgentSpec
  createdBy: ThreadId; // Full hierarchical thread ID of creating agent
  threadId: ThreadId; // Parent thread ID only (e.g., "lace_20250703_abc123")
  createdAt: Date;
  updatedAt: Date;
  notes: TaskNote[];
}

export interface TaskNote {
  id: string;
  author: ThreadId; // Full hierarchical thread ID of author
  content: string;
  timestamp: Date;
}
