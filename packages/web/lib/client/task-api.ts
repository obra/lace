// ABOUTME: Client-side API for task management operations
// ABOUTME: Provides type-safe methods for interacting with task API endpoints

import type { Task, TaskStatus, TaskPriority } from '@/lib/core';

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

  async listTasks(projectId: string, sessionId: string, filters?: TaskFilters): Promise<Task[]> {
    let url = `${this.baseUrl}/api/projects/${projectId}/sessions/${sessionId}/tasks`;

    if (filters) {
      const params = new URLSearchParams();
      if (filters.status) params.append('status', filters.status);
      if (filters.priority) params.append('priority', filters.priority);
      if (filters.assignedTo) params.append('assignedTo', filters.assignedTo);
      if (filters.createdBy) params.append('createdBy', filters.createdBy);

      if (params.toString()) {
        url += `?${params}`;
      }
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to fetch tasks');
    }

    const data = (await response.json()) as { tasks: Task[] };
    return data.tasks;
  }

  async createTask(projectId: string, sessionId: string, task: CreateTaskRequest): Promise<Task> {
    const response = await fetch(
      `${this.baseUrl}/api/projects/${projectId}/sessions/${sessionId}/tasks`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to create task');
    }

    const data = (await response.json()) as { task: Task };
    return data.task;
  }

  async getTask(projectId: string, sessionId: string, taskId: string): Promise<Task> {
    const response = await fetch(
      `${this.baseUrl}/api/projects/${projectId}/sessions/${sessionId}/tasks/${taskId}`
    );

    if (!response.ok) {
      throw new Error('Failed to fetch task');
    }

    const data = (await response.json()) as { task: Task };
    return data.task;
  }

  async updateTask(
    projectId: string,
    sessionId: string,
    taskId: string,
    updates: UpdateTaskRequest
  ): Promise<Task> {
    const response = await fetch(
      `${this.baseUrl}/api/projects/${projectId}/sessions/${sessionId}/tasks/${taskId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to update task');
    }

    const data = (await response.json()) as { task: Task };
    return data.task;
  }

  async deleteTask(projectId: string, sessionId: string, taskId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/projects/${projectId}/sessions/${sessionId}/tasks/${taskId}`,
      {
        method: 'DELETE',
      }
    );

    if (!response.ok) {
      throw new Error('Failed to delete task');
    }
  }

  async addNote(
    projectId: string,
    sessionId: string,
    taskId: string,
    content: string,
    author?: string
  ): Promise<Task> {
    const requestBody: { content: string; author?: string } = { content };
    if (author) {
      requestBody.author = author;
    }

    const response = await fetch(
      `${this.baseUrl}/api/projects/${projectId}/sessions/${sessionId}/tasks/${taskId}/notes`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to add note');
    }

    const data = (await response.json()) as { message: string; task: Task };
    return data.task;
  }
}
