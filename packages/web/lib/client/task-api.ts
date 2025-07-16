// ABOUTME: Client-side API for task management operations
// ABOUTME: Provides type-safe methods for interacting with task API endpoints

import type { Task, TaskStatus, TaskPriority } from '@/types/api';

export interface TaskFilters {
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedTo?: string;
  createdBy?: string;
}

export interface CreateTaskRequest {
  title: string;
  description?: string;
  prompt: string;
  priority?: TaskPriority;
  assignedTo?: string;
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  prompt?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedTo?: string;
}

export class TaskAPIClient {
  private baseUrl: string;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  async listTasks(sessionId: string, filters?: TaskFilters): Promise<Task[]> {
    const params = new URLSearchParams({ sessionId });
    if (filters?.status) params.append('status', filters.status);
    if (filters?.priority) params.append('priority', filters.priority);
    if (filters?.assignedTo) params.append('assignedTo', filters.assignedTo);
    if (filters?.createdBy) params.append('createdBy', filters.createdBy);

    const response = await fetch(`${this.baseUrl}/api/tasks?${params}`);
    if (!response.ok) {
      throw new Error('Failed to fetch tasks');
    }

    const data = (await response.json()) as { tasks: Task[] };
    return data.tasks;
  }

  async createTask(sessionId: string, task: CreateTaskRequest): Promise<Task> {
    const response = await fetch(`${this.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ...task }),
    });

    if (!response.ok) {
      throw new Error('Failed to create task');
    }

    const data = (await response.json()) as { task: Task };
    return data.task;
  }

  async getTask(sessionId: string, taskId: string): Promise<Task> {
    const params = new URLSearchParams({ sessionId });
    const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}?${params}`);

    if (!response.ok) {
      throw new Error('Failed to fetch task');
    }

    const data = (await response.json()) as { task: Task };
    return data.task;
  }

  async updateTask(sessionId: string, taskId: string, updates: UpdateTaskRequest): Promise<Task> {
    const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ...updates }),
    });

    if (!response.ok) {
      throw new Error('Failed to update task');
    }

    const data = (await response.json()) as { task: Task };
    return data.task;
  }

  async deleteTask(sessionId: string, taskId: string): Promise<void> {
    const params = new URLSearchParams({ sessionId });
    const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}?${params}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('Failed to delete task');
    }
  }

  async addNote(
    sessionId: string,
    taskId: string,
    content: string,
    author?: string
  ): Promise<Task> {
    const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, content, author }),
    });

    if (!response.ok) {
      throw new Error('Failed to add note');
    }

    const data = (await response.json()) as { message: string; task: Task };
    return data.task;
  }
}
