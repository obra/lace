// ABOUTME: Client-side API for task management operations
// ABOUTME: Provides type-safe methods for interacting with task API endpoints

import type { Task, TaskStatus, TaskPriority, TaskFilters } from '@/types/core';
import { api } from '@/lib/api-client';

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

    const data = await api.get<{ tasks: Task[] }>(url);
    return data.tasks;
  }

  async createTask(projectId: string, sessionId: string, task: CreateTaskRequest): Promise<Task> {
    const data = await api.post<{ task: Task }>(
      `${this.baseUrl}/api/projects/${projectId}/sessions/${sessionId}/tasks`,
      task
    );
    return data.task;
  }

  async getTask(projectId: string, sessionId: string, taskId: string): Promise<Task> {
    const data = await api.get<{ task: Task }>(
      `${this.baseUrl}/api/projects/${projectId}/sessions/${sessionId}/tasks/${taskId}`
    );
    return data.task;
  }

  async updateTask(
    projectId: string,
    sessionId: string,
    taskId: string,
    updates: UpdateTaskRequest
  ): Promise<Task> {
    const data = await api.patch<{ task: Task }>(
      `${this.baseUrl}/api/projects/${projectId}/sessions/${sessionId}/tasks/${taskId}`,
      updates
    );
    return data.task;
  }

  async deleteTask(projectId: string, sessionId: string, taskId: string): Promise<void> {
    await api.delete(
      `${this.baseUrl}/api/projects/${projectId}/sessions/${sessionId}/tasks/${taskId}`
    );
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

    const data = await api.post<{ message: string; task: Task }>(
      `${this.baseUrl}/api/projects/${projectId}/sessions/${sessionId}/tasks/${taskId}/notes`,
      requestBody
    );
    return data.task;
  }
}
